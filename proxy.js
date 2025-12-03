const semver = require("semver");
const fs = require("fs");
function startProxy(port, sslCaPath) {
    const Proxy = require("http-mitm-proxy").Proxy;
    // or using import/module (package.json -> "type": "module")
    // import { Proxy } from "http-mitm-proxy";
    const proxy = new Proxy();

    proxy.onError(function (ctx, err) {
        console.error("proxy error:", err);
    });

    proxy.onRequest(function (ctx, callback) {
        // 2. 过滤非 GET 请求或特殊路径
        if (
            ctx.clientToProxyRequest.method !== "GET" ||
            ctx.clientToProxyRequest.url.startsWith("/-/") ||
            ctx.clientToProxyRequest.url.endsWith(".tgz")
        ) {
            return callback();
        }

        // 3. 处理包元数据 (Package Metadata) 请求
        if (
            ctx.clientToProxyRequest.url.startsWith("/") &&
            ctx.clientToProxyRequest.url.lastIndexOf("/") === 0
        ) {
            // 使用 gunzip 中间件自动解压响应流 (非常重要，否则 chunks 是乱码)
            ctx.use(Proxy.gunzip);
            // 强制返回完整信息
            ctx.proxyToServerRequestOptions.headers["accept"] = "application/json";
            // 【新增 Step 1】：拦截响应头阶段
            ctx.onResponse(function (ctx, callback) {
                // 在 Header 发送给客户端之前，删除原来的长度和编码
                // 因为我们要修改内容，原来的长度肯定不对了
                delete ctx.serverToProxyResponse.headers["content-length"];
                // 因为用了 gunzip，原来的 gzip 编码也不对了
                delete ctx.serverToProxyResponse.headers["content-encoding"];

                // 确保没有 ETag，防止客户端缓存（可选，建议加上）
                delete ctx.serverToProxyResponse.headers["etag"];

                return callback();
            });

            const chunks = [];

            ctx.onResponseData(function (ctx, chunk, callback) {
                chunks.push(chunk);
                // 拦截数据，不直接转发
                return callback(null, null);
            });

            ctx.onResponseEnd(function (ctx, callback) {
                let fullBody = Buffer.concat(chunks).toString("utf8");

                try {
                    const metadata = JSON.parse(fullBody);
                    if (!metadata || typeof metadata !== "object" || metadata.name == null || metadata.versions == null || metadata.time == null || metadata["dist-tags"] == null) {
                        return callback();
                    }
                    metadataFilter(metadata, daysThreshold);

                    fullBody = JSON.stringify(metadata);
                    const newBuffer = Buffer.from(fullBody);

                    // 【关键修改 Step 2】：
                    // 此时 Header 早就发出去了，绝对不要调用 setHeader！
                    // 也不需要设置 Content-Length，Node.js 会自动以 chunked 形式发送 newBuffer

                    ctx.proxyToClientResponse.write(newBuffer);
                } catch (err) {
                    console.error("Error processing response:", err);
                    // 出错时发送原始内容
                    ctx.proxyToClientResponse.write(Buffer.concat(chunks));
                }

                return callback();
            });
        }

        // 必须调用这个 callback 才能让请求继续发往上游服务器
        return callback();
    });

    // console.log(`begin listening on ${port}`);
    proxy.listen({ port: port, host: "127.0.0.1", sslCaDir: sslCaPath }, err => {
        if (err) {
            console.error("Failed to start proxy:", err);
        } else {
            console.log(`Proxy server is running on port ${port}`);
        }
    });
}

function stopProxy() {
    process.exit(0);
}

function getTimeDeltaInDays(date1, date2) {
    const diffInMs = Math.abs(date2 - date1);
    return diffInMs / (1000 * 60 * 60 * 24);
}

function findDowngradedVersion(targetVersion, availableVersions, timemap) {
    // 1. 验证输入的目标版本是否有效
    if (!semver.valid(targetVersion)) {
        // 可以尝试自动修复常见格式问题，例如去除 'v' 前缀
        const cleaned = semver.coerce(targetVersion);
        if (!cleaned) {
            throw new Error(`无效的目标版本号: ${targetVersion}`);
        }
        targetVersion = cleaned.version;
    }

    // 解析目标版本的主要、次要、补丁号
    const targetMajor = semver.major(targetVersion);
    const targetMinor = semver.minor(targetVersion);
    const targetPatch = semver.patch(targetVersion);

    // 按版本从高到低排序，便于观察和某些场景下的性能优化（非必需）
    const sortedVersions = [...availableVersions].sort(semver.rcompare);

    // 3. 第一级：尝试查找 a.b.(c-1) 及更低的补丁版本（即同一 minor 版本下的最新版）
    // 构建范围：所有小于目标版本但主、次版本相同的版本，例如 '>=1.2.0 <1.2.3'
    if (targetPatch > 0) {
        const sameMinorRange = `>=${targetMajor}.${targetMinor}.0 <${targetVersion}`;
        const sameMinorVersion = semver.maxSatisfying(
            availableVersions,
            sameMinorRange
        );
        if (sameMinorVersion) {
            return sameMinorVersion;
        }
    }

    // 4. 第三级：尝试查找 a.(b-1).x 及更低的次版本中的最新版（即降一个 minor 版本）
    // 构建范围：主版本相同，次版本小于目标次版本的所有版本，例如 '>=1.1.0 <1.2.0'
    if (targetMinor > 0) {
        const lowerMinorRange = `>=${targetMajor}.${
            targetMinor - 1
        }.0 <${targetMajor}.${targetMinor}.0`;
        const lowerMinorVersion = semver.maxSatisfying(
            availableVersions,
            lowerMinorRange
        );
        if (lowerMinorVersion) {
            return lowerMinorVersion;
        }
    }

    // 5. 可以继续扩展：如果 a.(b-1).x 也没有，可以查找 a.(b-2).x，或者降级主版本 (a-1).x.x
    // 查找更低的主版本中的最新版
    if (targetMajor > 0) {
        const lowerMajorRange = `>=${targetMajor - 1}.0.0 <${targetMajor}.0.0`;
        const lowerMajorVersion = semver.maxSatisfying(
            availableVersions,
            lowerMajorRange
        );
        if (lowerMajorVersion) {
            return lowerMajorVersion;
        }
    }

    // 所有策略都未找到，返回 null
    return null;
}

function metadataFilter(metadata, daysThreshold = 15) {
    // 在这里对 metadata 进行修改

    const latestVersion = metadata["dist-tags"] && metadata["dist-tags"].latest;
    if (latestVersion == null) {
        return metadata;
    }

    const latestPublishTime = new Date(metadata.time[latestVersion]);
    const daysDelta = getTimeDeltaInDays(new Date(), latestPublishTime);

    // 最新版发布15天以上的, 不做处理
    if (daysDelta >= daysThreshold) {
        console.log(`${metadata.name} latest version ${latestVersion} published ${Math.floor(daysDelta)} days ago. No downgrade needed.`);
        return metadata;
    }

    // 降级到发布超过15天的次新版本
    const availableVersions = Object.keys(metadata.versions || {}).filter(
        (v) =>
            metadata.time[v] &&
            getTimeDeltaInDays(new Date(), new Date(metadata.time[v])) >=
                daysThreshold
    );
    const downgradedVersion = findDowngradedVersion(
        latestVersion,
        availableVersions
    );
    if (downgradedVersion && downgradedVersion !== latestVersion) {
        console.log(
            `Downgrading ${metadata.name} from ${latestVersion} to ${downgradedVersion}`
        );
        metadata["dist-tags"].latest = downgradedVersion;
        delete metadata.versions[latestVersion];
    } else {
        console.error(
            `No suitable downgraded version found for ${metadata.name} (${latestVersion}). skipping downgrade.`
        );
    }

    return metadata;
}

module.exports = {
    startProxy,
    stopProxy,
};

const port = process.argv[2] || 8081;
const sslPath = process.argv[3] || "./ssl";
const daysThreshold = process.argv[4] || 15;
startProxy(port, sslPath, daysThreshold);