/**
 * cloudflared 子进程管理
 * 支持 spawn/kill/指数退避重启/平台适配
 */

import { spawn, execSync, type ChildProcess } from "node:child_process";

export type CloudflaredProcessOptions = {
    cloudflaredPath?: string;
    tunnelToken: string;
    autoRestart?: boolean;
};

export type CloudflaredProcess = {
    stop: () => Promise<void>;
    isRunning: () => boolean;
    getPid: () => number | null;
};

const BACKOFF_INITIAL_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;
const BACKOFF_MULTIPLIER = 2;
const STABLE_THRESHOLD_MS = 30_000;

/**
 * 启动 cloudflared 子进程
 */
export function startCloudflared(opts: CloudflaredProcessOptions): CloudflaredProcess {
    const { cloudflaredPath = "cloudflared", tunnelToken, autoRestart = true } = opts;

    let child: ChildProcess | null = null;
    let stopped = false;
    let backoffMs = BACKOFF_INITIAL_MS;
    let restartTimer: ReturnType<typeof setTimeout> | null = null;
    let startTime: number = 0;

    function doSpawn(): void {
        if (stopped) return;

        const args = ["tunnel", "run", "--token", tunnelToken];
        console.log("wenyan-tunnel: starting cloudflared...");

        startTime = Date.now();
        child = spawn(cloudflaredPath, args, {
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });

        const pid = child.pid;
        if (pid) {
            console.log(`wenyan-tunnel: cloudflared started (pid=${pid})`);
        }

        child.stdout?.on("data", (chunk: Buffer) => {
            const line = chunk.toString("utf-8").trimEnd();
            if (line) console.log(`cloudflared: ${line}`);
        });

        child.stderr?.on("data", (chunk: Buffer) => {
            const line = chunk.toString("utf-8").trimEnd();
            if (line) console.log(`cloudflared: ${line}`);
        });

        child.on("error", (err) => {
            console.error(`wenyan-tunnel: cloudflared spawn error: ${err.message}`);
            child = null;
            scheduleRestart();
        });

        child.on("exit", (code, signal) => {
            const runDuration = Date.now() - startTime;
            console.warn(
                `wenyan-tunnel: cloudflared exited (code=${code}, signal=${signal}, ran ${Math.round(runDuration / 1000)}s)`,
            );
            child = null;

            if (stopped) return;

            if (runDuration >= STABLE_THRESHOLD_MS) {
                backoffMs = BACKOFF_INITIAL_MS;
            }

            scheduleRestart();
        });
    }

    function scheduleRestart(): void {
        if (stopped || !autoRestart) return;

        console.log(`wenyan-tunnel: restarting cloudflared in ${backoffMs / 1000}s...`);
        restartTimer = setTimeout(() => {
            restartTimer = null;
            doSpawn();
        }, backoffMs);

        backoffMs = Math.min(backoffMs * BACKOFF_MULTIPLIER, BACKOFF_MAX_MS);
    }

    async function stop(): Promise<void> {
        stopped = true;

        if (restartTimer) {
            clearTimeout(restartTimer);
            restartTimer = null;
        }

        if (!child || child.exitCode !== null) {
            child = null;
            return;
        }

        const pid = child.pid;
        console.log(`wenyan-tunnel: stopping cloudflared (pid=${pid})...`);

        await killProcess(child);
        child = null;
    }

    doSpawn();

    return {
        stop,
        isRunning: () => child !== null && child.exitCode === null,
        getPid: () => child?.pid ?? null,
    };
}

async function killProcess(child: ChildProcess): Promise<void> {
    const pid = child.pid;
    if (!pid) return;

    return new Promise<void>((resolve) => {
        const GRACEFUL_TIMEOUT_MS = 5_000;
        let resolved = false;

        const done = () => {
            if (!resolved) {
                resolved = true;
                resolve();
            }
        };

        child.once("exit", done);

        if (process.platform === "win32") {
            try {
                execSync(`taskkill /PID ${pid} /T`, { timeout: 3_000, stdio: "ignore" });
            } catch {
                // taskkill 可能会失败（进程已退出等）
            }
        } else {
            child.kill("SIGTERM");
        }

        setTimeout(() => {
            if (resolved) return;

            console.warn(`wenyan-tunnel: cloudflared did not exit gracefully, force killing (pid=${pid})`);

            if (process.platform === "win32") {
                try {
                    execSync(`taskkill /PID ${pid} /T /F`, { timeout: 3_000, stdio: "ignore" });
                } catch {
                    // ignore
                }
            } else {
                try {
                    child.kill("SIGKILL");
                } catch {
                    // ignore
                }
            }

            setTimeout(done, 1_000);
        }, GRACEFUL_TIMEOUT_MS);
    });
}
