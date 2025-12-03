#!/usr/bin/env node

const { exec, execSync, fork } = require("child_process");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const path = require("path");

function getRandomDir() {
    const randomStr = crypto.randomBytes(8).toString("hex");
    const tempDir = os.tmpdir();
    return path.join(tempDir, `npmproxy-${randomStr}`);
}

function getRandomPort(min = 10000, max = 65535) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function initConfig() {
    if (!fs.existsSync("npmproxy.json")) {
        fs.writeFileSync(
            "npmproxy.json",
            JSON.stringify(
                {
                    port: getRandomPort(),
                    sslPath: getRandomDir(),
                    daysThreshold: 15,
                },
                null,
                4
            )
        );
    } else {
        console.log("npmproxy.json already exists. skipping initialization.");
    }
}

function readConfig() {
    if (fs.existsSync("npmproxy.json")) {
        const configContent = fs.readFileSync("npmproxy.json", "utf-8");
        return JSON.parse(configContent);
    } else {
        throw new Error(
            "Configuration file npmproxy.json not found. Please run 'init' command first."
        );
    }
}

const subcmd = process.argv[2];
const args = process.argv.slice(2);
if (subcmd === "help") {
    console.log("Usage: node index.js [subcommand]");
} else if (subcmd === "init") {
    initConfig();
} else if (subcmd === "stop") {
    // 寻找并终止代理服务器进程
    const config = readConfig();
    const port = config.port || 8081;
} else if (["yarn", "npm", "pnpm"].includes(subcmd)) {
    const config = readConfig();

    const proxyPort = config.port || 8081;
    const proxyLink = `http://127.0.0.1:${proxyPort}`;
    const sslCaPath = config.sslPath || getRandomDir();
    const daysThreshold = config.daysThreshold || 15;

    // 设置环境变量, 信任自签名CA
    const caFile = path.join(sslCaPath, "certs", "ca.pem");
    let cmd,
        cmdenv = {
            GIT_SSL_CAINFO: caFile,
            CURL_CA_BUNDLE: caFile,
            REQUESTS_CA_BUNDLE: caFile,
        };

    if (subcmd === "yarn") {
        // execSync("yarn cache clean", { stdio: "ignore" });
        cmd = args.join(" ");
        cmdenv["http_proxy"] = proxyLink;
        cmdenv["https_proxy"] = proxyLink;
        try {
            execSync(`yarn config set -H httpProxy ${proxyLink}`, {
                stdio: "ignore",
            });
            execSync(`yarn config set -H httpsProxy ${proxyLink}`, {
                stdio: "ignore",
            });
        } catch (e) {}
    } else if (subcmd === "npm") {
        // execSync("npm cache clean --force", { stdio: "ignore" });
        args.push("--proxy");
        args.push(proxyLink);
        args.push("--https-proxy");
        args.push(proxyLink);
        cmd = args.join(" ");
    } else if (subcmd === "pnpm") {
        throw new Error("pnpm support not implemented yet.");
    }

    cmdenv["NODE_EXTRA_CA_CERTS"] = path.join(sslCaPath, "certs", "ca.pem");

    const child = fork(
        require.resolve("./proxy.js"),
        [proxyPort, sslCaPath, daysThreshold],
        {
            stdio: "inherit",
        }
    );

    execSync(cmd, { env: { ...process.env, ...cmdenv }, stdio: "inherit" });

    // 停止代理服务器
    child.kill();

    if (subcmd === "yarn") {
        try {
            execSync(`yarn config unset -H httpProxy`, { stdio: "ignore" });
            execSync(`yarn config unset -H httpsProxy`, { stdio: "ignore" });
        } catch (e) {}
    }
} else {
    console.log("Unknown subcommand. Use 'help' for usage information.");
}

// execSync(cmd, {stdio: 'inherit'});
