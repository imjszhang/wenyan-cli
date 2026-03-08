/**
 * 检测 cloudflared 是否已安装
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export type DetectResult = {
    found: boolean;
    path: string | null;
    version: string | null;
    installHint: string | null;
};

/**
 * 检测 cloudflared 安装情况
 * @param customPath 用户自定义的 cloudflared 路径
 */
export async function detectCloudflared(customPath?: string): Promise<DetectResult> {
    const candidates = buildCandidates(customPath);

    for (const candidate of candidates) {
        const version = await tryGetVersion(candidate);
        if (version) {
            return { found: true, path: candidate, version, installHint: null };
        }
    }

    return {
        found: false,
        path: null,
        version: null,
        installHint: getInstallHint(),
    };
}

function buildCandidates(customPath?: string): string[] {
    const candidates: string[] = [];

    if (customPath) {
        candidates.push(customPath);
    }

    candidates.push("cloudflared");

    if (process.platform === "win32") {
        const programFiles = process.env.PROGRAMFILES ?? "C:\\Program Files";
        const programFilesX86 = process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)";
        const localAppData = process.env.LOCALAPPDATA ?? "";

        const winPaths = [
            path.join(programFiles, "cloudflared", "cloudflared.exe"),
            path.join(programFilesX86, "cloudflared", "cloudflared.exe"),
            localAppData ? path.join(localAppData, "cloudflared", "cloudflared.exe") : "",
            "C:\\cloudflared\\cloudflared.exe",
        ].filter(Boolean);

        for (const p of winPaths) {
            if (fs.existsSync(p)) {
                candidates.push(p);
            }
        }
    }

    return candidates;
}

function tryGetVersion(cmd: string): Promise<string | null> {
    return new Promise((resolve) => {
        try {
            execFile(cmd, ["version"], { timeout: 10_000 }, (err, stdout, stderr) => {
                if (err) {
                    resolve(null);
                    return;
                }
                const output = (stdout || stderr || "").trim();
                const match = output.match(/cloudflared version\s+([\d.]+)/i);
                resolve(match ? match[1] : output.slice(0, 60) || "unknown");
            });
        } catch {
            resolve(null);
        }
    });
}

function getInstallHint(): string {
    const platform = process.platform;

    if (platform === "win32") {
        return [
            "cloudflared 未安装。请通过以下方式之一安装：",
            "  • winget install Cloudflare.cloudflared",
            "  • scoop install cloudflared",
            "  • 下载: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/",
        ].join("\n");
    }

    if (platform === "darwin") {
        return [
            "cloudflared 未安装。请通过以下方式之一安装：",
            "  • brew install cloudflared",
            "  • 下载: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/",
        ].join("\n");
    }

    return [
        "cloudflared 未安装。请通过以下方式之一安装：",
        "  • apt install cloudflared  (Debian/Ubuntu)",
        "  • yum install cloudflared  (CentOS/RHEL)",
        "  • 下载: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/",
    ].join("\n");
}
