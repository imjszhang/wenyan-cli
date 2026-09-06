import { describe, it, expect, afterEach } from "vitest";
import { redactProxyUrl, resolveProxyUrl, toUndiciProxyUrl } from "../src/proxy.js";

const PROXY_KEYS = ["ALL_PROXY", "all_proxy", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] as const;

describe("proxy helpers", () => {
    const original = Object.fromEntries(PROXY_KEYS.map((key) => [key, process.env[key]]));

    afterEach(() => {
        for (const key of PROXY_KEYS) {
            if (original[key] === undefined) delete process.env[key];
            else process.env[key] = original[key];
        }
    });

    it("prefers explicit proxy over env", () => {
        process.env.HTTP_PROXY = "http://127.0.0.1:8080";
        expect(resolveProxyUrl("socks5://127.0.0.1:1080")).toBe("socks5://127.0.0.1:1080");
    });

    it("reads ALL_PROXY before HTTP_PROXY", () => {
        for (const key of PROXY_KEYS) delete process.env[key];
        process.env.HTTP_PROXY = "http://127.0.0.1:8080";
        process.env.ALL_PROXY = "socks5://127.0.0.1:1080";
        expect(resolveProxyUrl()).toBe("socks5://127.0.0.1:1080");
    });

    it("normalizes socks5h for undici", () => {
        expect(toUndiciProxyUrl("socks5h://127.0.0.1:1080")).toBe("socks5://127.0.0.1:1080");
        expect(toUndiciProxyUrl("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    });

    it("redacts proxy passwords", () => {
        expect(redactProxyUrl("socks5://user:secret@127.0.0.1:1080")).toBe(
            "socks5://user:***@127.0.0.1:1080",
        );
    });
});
