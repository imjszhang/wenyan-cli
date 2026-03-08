/**
 * Tunnel 编排
 * 导出 startTunnel / stopTunnel 用于在 serve 命令中管理 Cloudflare Tunnel 生命周期
 */

import { configDir } from "@wenyan-md/core/wrapper";
import { detectCloudflared } from "./detect.js";
import { loadState, saveState, clearState } from "./state.js";
import {
    listTunnels,
    createTunnel,
    updateIngress,
    ensureDnsRecord,
    getTunnelStatus,
    type CloudflareApiContext,
} from "./cloudflare-api.js";
import { startCloudflared, type CloudflaredProcess } from "./process.js";
import type { TunnelCloudflareConfig, TunnelRuntime, TunnelState } from "./types.js";

const TUNNEL_NAME = "wenyan-server";
const HEALTH_CHECK_DELAY_MS = 8_000;
const ALLOWED_PATHS = ["/upload", "/publish", "/health", "/verify"];

let _tunnelRuntime: TunnelRuntime = {
    running: false,
    hostname: null,
    tunnelId: null,
    publicUrl: null,
    error: null,
};

let _cloudflaredProcess: CloudflaredProcess | null = null;

export function getTunnelRuntime(): TunnelRuntime {
    return _tunnelRuntime;
}

export interface StartTunnelOptions {
    cloudflare: TunnelCloudflareConfig;
    localPort: number;
    cloudflaredPath?: string;
}

/**
 * 启动 Cloudflare Tunnel
 * 不会 throw — tunnel 失败不阻塞 Server
 */
export async function startTunnel(opts: StartTunnelOptions): Promise<void> {
    const { cloudflare: cfConfig, localPort, cloudflaredPath } = opts;

    _tunnelRuntime = {
        running: false,
        hostname: cfConfig.hostname,
        tunnelId: null,
        publicUrl: null,
        error: null,
    };

    try {
        console.log("wenyan-tunnel: checking cloudflared installation...");
        const detect = await detectCloudflared(cloudflaredPath);
        if (!detect.found) {
            const msg = detect.installHint ?? "cloudflared not found";
            console.warn(`wenyan-tunnel: ${msg}`);
            _tunnelRuntime.error = msg;
            return;
        }
        console.log(`wenyan-tunnel: cloudflared found (version=${detect.version}, path=${detect.path})`);

        const cfCtx: CloudflareApiContext = {
            apiToken: cfConfig.apiToken,
            accountId: cfConfig.accountId,
            zoneId: cfConfig.zoneId,
        };

        // 获取或创建隧道
        let tunnelId: string;
        let tunnelToken: string;

        const stateDir = configDir;
        const cached = loadState(stateDir);
        if (cached) {
            console.log(`wenyan-tunnel: found cached tunnel state (tunnelId=${cached.tunnelId})`);
            try {
                const status = await getTunnelStatus(cfCtx, cached.tunnelId);
                console.log(`wenyan-tunnel: cached tunnel is alive (status=${status.status})`);
                tunnelId = cached.tunnelId;
                tunnelToken = cached.tunnelToken;
            } catch {
                console.warn("wenyan-tunnel: cached tunnel not found on Cloudflare, recreating...");
                clearState(stateDir);
                const result = await ensureOrCreateTunnel(cfCtx);
                tunnelId = result.tunnelId;
                tunnelToken = result.tunnelToken;
            }
        } else {
            const result = await ensureOrCreateTunnel(cfCtx);
            tunnelId = result.tunnelId;
            tunnelToken = result.tunnelToken;
        }

        _tunnelRuntime.tunnelId = tunnelId;

        // 配置 ingress 规则（仅允许指定路径）
        console.log(
            `wenyan-tunnel: configuring ingress (hostname=${cfConfig.hostname}, paths=[${ALLOWED_PATHS.join(", ")}], port=${localPort})`,
        );
        await updateIngress(cfCtx, tunnelId, {
            hostname: cfConfig.hostname,
            localPort,
            allowedPaths: ALLOWED_PATHS,
        });

        // 确保 DNS 记录
        console.log(`wenyan-tunnel: ensuring DNS CNAME record for ${cfConfig.hostname}...`);
        const dnsRecordId = await ensureDnsRecord(cfCtx, {
            hostname: cfConfig.hostname,
            tunnelId,
        });
        console.log(`wenyan-tunnel: DNS record ready (recordId=${dnsRecordId})`);

        // 保存状态
        const state: TunnelState = {
            tunnelId,
            tunnelToken,
            tunnelName: TUNNEL_NAME,
            dnsRecordId,
            hostname: cfConfig.hostname,
            createdAt: cached?.createdAt ?? new Date().toISOString(),
            lastHealthy: null,
        };
        saveState(stateDir, state);

        // 启动 cloudflared 子进程
        console.log("wenyan-tunnel: starting cloudflared process...");
        _cloudflaredProcess = startCloudflared({
            cloudflaredPath: detect.path ?? "cloudflared",
            tunnelToken,
            autoRestart: true,
        });

        // 等待并检查健康状态
        await sleep(HEALTH_CHECK_DELAY_MS);
        try {
            const health = await getTunnelStatus(cfCtx, tunnelId);
            if (health.connections?.length > 0) {
                state.lastHealthy = new Date().toISOString();
                saveState(stateDir, state);
            }
        } catch (err: any) {
            console.warn(`wenyan-tunnel: health check failed: ${err.message}`);
        }

        _tunnelRuntime.running = true;
        _tunnelRuntime.publicUrl = `https://${cfConfig.hostname}`;
        console.log(`wenyan-tunnel: tunnel ready → ${_tunnelRuntime.publicUrl}`);
    } catch (err: any) {
        const msg = `wenyan-tunnel: failed to start: ${err.message}`;
        console.error(msg);
        _tunnelRuntime.error = msg;
    }
}

/**
 * 停止 Cloudflare Tunnel
 */
export async function stopTunnel(): Promise<void> {
    console.log("wenyan-tunnel: stopping...");

    if (_cloudflaredProcess) {
        await _cloudflaredProcess.stop();
        _cloudflaredProcess = null;
    }

    _tunnelRuntime.running = false;
    console.log("wenyan-tunnel: stopped (tunnel and DNS resources preserved for reuse)");
}

async function ensureOrCreateTunnel(
    cfCtx: CloudflareApiContext,
): Promise<{ tunnelId: string; tunnelToken: string }> {
    console.log(`wenyan-tunnel: checking for existing tunnel "${TUNNEL_NAME}"...`);
    const existing = await listTunnels(cfCtx, TUNNEL_NAME);

    if (existing.length > 0) {
        const tunnel = existing[0];
        console.log(`wenyan-tunnel: reusing existing tunnel (id=${tunnel.id}, name=${tunnel.name})`);
        console.warn(
            "wenyan-tunnel: existing tunnel found but token not available from API. " +
                "If this is a fresh start, you may need to delete the tunnel on Cloudflare dashboard and let it recreate.",
        );
    }

    console.log(`wenyan-tunnel: creating new tunnel "${TUNNEL_NAME}"...`);
    const result = await createTunnel(cfCtx, TUNNEL_NAME);
    console.log(`wenyan-tunnel: tunnel created (id=${result.id})`);

    return {
        tunnelId: result.id,
        tunnelToken: result.token,
    };
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
