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
                    npmRegistry: "https://registry.npmjs.org/",
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
} else if (["yarn", "npm", "pnpm"].includes(subcmd)) {
    const config = readConfig();

    const proxyPort = config.port || 8081;
    const sslCaPath = config.sslPath || getRandomDir();
    const registry = config.npmRegistry || "https://registry.npmjs.org/";
    const daysThreshold = config.daysThreshold || 15;

    if (subcmd === "yarn") {
        execSync("yarn cache clean", { stdio: "ignore" });
        if (args.indexOf("--registry") === -1) {
            args.push(`--registry=${registry}`);
        } else {
            const regIndex = args.indexOf("--registry");
            args[regIndex + 1] = registry;
        }
    } else if (subcmd === "npm") {
        execSync("npm cache clean --force", { stdio: "ignore" });
        if (args.indexOf("--registry") === -1) {
            args.push(`--registry=${registry}`);
        } else {
            const regIndex = args.indexOf("--registry");
            args[regIndex + 1] = registry;
        }
    } else if (subcmd === "pnpm") {
        throw new Error("pnpm support not implemented yet.");
    }

    const cmd = args.join(" ");
    const cmdenv = {
        NODE_EXTRA_CA_CERTS: path.join(sslCaPath, "certs", "ca.pem"),
        HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`,
        HTTP_PROXY: `http://127.0.0.1:${proxyPort}`,
    };

    const child = fork(
        require.resolve("./proxy.js"),
        [proxyPort, sslCaPath, registry, daysThreshold],
        {
            stdio: "inherit",
        }
    );

    execSync(cmd, { env: { ...process.env, ...cmdenv }, stdio: "inherit" });

    // 停止代理服务器
    child.kill();
} else {
    console.log("Unknown subcommand. Use 'help' for usage information.");
}

// execSync(cmd, {stdio: 'inherit'});
