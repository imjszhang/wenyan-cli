import http from "node:http";
import https from "node:https";

const PROXY_ENV_KEYS = [
    "ALL_PROXY",
    "all_proxy",
    "HTTPS_PROXY",
    "https_proxy",
    "HTTP_PROXY",
    "http_proxy",
] as const;

let enabledUrl: string | undefined;

export function resolveProxyUrl(explicit?: string): string | undefined {
    const raw = explicit?.trim() || PROXY_ENV_KEYS.map((key) => process.env[key]?.trim()).find(Boolean);
    return raw || undefined;
}

/** undici Socks5ProxyAgent 只认 socks5: / socks:，socks5h 需归一化。 */
export function toUndiciProxyUrl(url: string): string {
    return url.replace(/^socks5h:/i, "socks5:").replace(/^socks4a:/i, "socks4:");
}

export function redactProxyUrl(url: string): string {
    try {
        const parsed = new URL(url);
        if (parsed.password) parsed.password = "***";
        return parsed.toString();
    } catch {
        return url;
    }
}

/**
 * 让全局 fetch 和 Node http/https 都走代理。
 * 支持 http://、https://、socks5://、socks5h://。
 */
export async function setupProxy(explicit?: string): Promise<string | undefined> {
    const url = resolveProxyUrl(explicit);
    if (!url) return undefined;
    if (enabledUrl === url) return url;

    const { ProxyAgent, setGlobalDispatcher, install } = await import("undici");
    const { ProxyAgent: NodeProxyAgent } = await import("proxy-agent");

    setGlobalDispatcher(new ProxyAgent(toUndiciProxyUrl(url)));
    install();

    const nodeAgent = explicit
        ? new NodeProxyAgent({ getProxyForUrl: () => url })
        : new NodeProxyAgent();
    http.globalAgent = nodeAgent as unknown as http.Agent;
    https.globalAgent = nodeAgent as unknown as https.Agent;

    enabledUrl = url;
    console.error(`[Proxy] ${redactProxyUrl(url)}`);
    return url;
}
