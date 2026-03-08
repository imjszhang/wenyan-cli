/**
 * Cloudflare REST API 封装
 * 使用 Node.js 内置 fetch，零外部依赖
 */

export type CloudflareApiContext = {
    apiToken: string;
    accountId: string;
    zoneId: string;
};

export type CloudflareResponse<T = unknown> = {
    success: boolean;
    errors: Array<{ code: number; message: string }>;
    messages: string[];
    result: T;
};

export type CfTunnel = {
    id: string;
    name: string;
    status: string;
    created_at: string;
    connections: Array<{
        id: string;
        is_pending_reconnect: boolean;
        origin_ip: string;
        opened_at: string;
    }>;
};

export type CfTunnelCreateResult = {
    id: string;
    name: string;
    token: string;
    status: string;
    created_at: string;
};

export type CfDnsRecord = {
    id: string;
    type: string;
    name: string;
    content: string;
    proxied: boolean;
};

export type CfIngressRule = {
    hostname?: string;
    service: string;
    path?: string;
};

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

async function cfFetch<T>(
    ctx: CloudflareApiContext,
    path: string,
    init?: RequestInit,
): Promise<CloudflareResponse<T>> {
    const url = `${CF_API_BASE}${path}`;
    const res = await fetch(url, {
        ...init,
        headers: {
            Authorization: `Bearer ${ctx.apiToken}`,
            "Content-Type": "application/json",
            ...(init?.headers as Record<string, string> | undefined),
        },
    });

    const json = (await res.json()) as CloudflareResponse<T>;

    if (!json.success) {
        const errMsg = json.errors?.map((e) => `[${e.code}] ${e.message}`).join("; ") ?? "Unknown error";
        throw new Error(`Cloudflare API error (${path}): ${errMsg}`);
    }

    return json;
}

/**
 * 列出同名隧道（未删除的）
 */
export async function listTunnels(ctx: CloudflareApiContext, tunnelName: string): Promise<CfTunnel[]> {
    const encodedName = encodeURIComponent(tunnelName);
    const resp = await cfFetch<CfTunnel[]>(
        ctx,
        `/accounts/${ctx.accountId}/cfd_tunnel?name=${encodedName}&is_deleted=false`,
    );
    return resp.result ?? [];
}

/**
 * 创建新隧道（Remote Config 模式）
 */
export async function createTunnel(ctx: CloudflareApiContext, tunnelName: string): Promise<CfTunnelCreateResult> {
    const resp = await cfFetch<CfTunnelCreateResult>(ctx, `/accounts/${ctx.accountId}/cfd_tunnel`, {
        method: "POST",
        body: JSON.stringify({
            name: tunnelName,
            tunnel_secret: generateTunnelSecret(),
            config_src: "cloudflare",
        }),
    });
    return resp.result;
}

/**
 * 更新隧道 ingress 配置
 * 支持多条路径规则 + catch-all 403
 */
export async function updateIngress(
    ctx: CloudflareApiContext,
    tunnelId: string,
    opts: {
        hostname: string;
        localPort: number;
        allowedPaths: string[];
    },
): Promise<void> {
    const ingress: CfIngressRule[] = opts.allowedPaths.map((p) => ({
        hostname: opts.hostname,
        service: `http://localhost:${opts.localPort}`,
        path: `^${escapeRegex(p)}$`,
    }));

    ingress.push({ service: "http_status:403" });

    await cfFetch(ctx, `/accounts/${ctx.accountId}/cfd_tunnel/${tunnelId}/configurations`, {
        method: "PUT",
        body: JSON.stringify({ config: { ingress } }),
    });
}

/**
 * 确保 DNS CNAME 记录存在并指向隧道
 */
export async function ensureDnsRecord(
    ctx: CloudflareApiContext,
    opts: { hostname: string; tunnelId: string },
): Promise<string> {
    const tunnelCname = `${opts.tunnelId}.cfargotunnel.com`;

    const encodedName = encodeURIComponent(opts.hostname);
    const listResp = await cfFetch<CfDnsRecord[]>(
        ctx,
        `/zones/${ctx.zoneId}/dns_records?type=CNAME&name=${encodedName}`,
    );

    const existing = listResp.result?.find((r) => r.name === opts.hostname);

    if (existing) {
        await cfFetch(ctx, `/zones/${ctx.zoneId}/dns_records/${existing.id}`, {
            method: "PUT",
            body: JSON.stringify({
                type: "CNAME",
                name: opts.hostname,
                content: tunnelCname,
                proxied: true,
            }),
        });
        return existing.id;
    } else {
        const createResp = await cfFetch<CfDnsRecord>(ctx, `/zones/${ctx.zoneId}/dns_records`, {
            method: "POST",
            body: JSON.stringify({
                type: "CNAME",
                name: opts.hostname,
                content: tunnelCname,
                proxied: true,
            }),
        });
        return createResp.result.id;
    }
}

/**
 * 获取隧道状态
 */
export async function getTunnelStatus(ctx: CloudflareApiContext, tunnelId: string): Promise<CfTunnel> {
    const resp = await cfFetch<CfTunnel>(ctx, `/accounts/${ctx.accountId}/cfd_tunnel/${tunnelId}`);
    return resp.result;
}

function generateTunnelSecret(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Buffer.from(bytes).toString("base64");
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
