/**
 * Tunnel 状态持久化
 * 在 stateDir 下维护 wenyan-tunnel.json
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { TunnelState } from "./types.js";

const STATE_FILENAME = "wenyan-tunnel.json";

/**
 * 从 stateDir 加载缓存的 tunnel 状态
 * 文件不存在或格式错误时返回 null
 */
export function loadState(stateDir: string): TunnelState | null {
    const filePath = path.join(stateDir, STATE_FILENAME);
    try {
        if (!fs.existsSync(filePath)) {
            return null;
        }
        const raw = fs.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(raw) as TunnelState;

        if (!parsed.tunnelId || !parsed.tunnelToken || !parsed.tunnelName) {
            return null;
        }

        return parsed;
    } catch {
        return null;
    }
}

/**
 * 保存 tunnel 状态到 stateDir
 */
export function saveState(stateDir: string, state: TunnelState): void {
    const filePath = path.join(stateDir, STATE_FILENAME);

    fs.mkdirSync(stateDir, { recursive: true });

    const content = JSON.stringify(state, null, 2);
    fs.writeFileSync(filePath, content, { encoding: "utf-8", mode: 0o600 });
}

/**
 * 清除 stateDir 中的 tunnel 状态文件
 */
export function clearState(stateDir: string): void {
    const filePath = path.join(stateDir, STATE_FILENAME);
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch {
        // 忽略删除失败
    }
}
