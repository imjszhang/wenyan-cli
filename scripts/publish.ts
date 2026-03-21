import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const WORK_DIR = path.join(ROOT, "work_dir");

async function loadEnv(envPath: string): Promise<void> {
    try {
        const content = await fs.readFile(envPath, "utf-8");
        for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (trimmed.startsWith("#") || !trimmed) continue;
            const eq = trimmed.indexOf("=");
            if (eq > 0) {
                const key = trimmed.slice(0, eq).trim();
                let value = trimmed.slice(eq + 1).trim();
                if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.slice(1, -1);
                }
                if (key) process.env[key] = value;
            }
        }
    } catch {
        // .env 不存在时静默跳过
    }
}

/**
 * article-path 格式: <series>/<id>  (如 yangxia-series/07)
 * 也兼容直接传完整文件路径。
 */
function resolveOutputFile(input: string): string {
    if (input.includes("/") || input.includes("\\")) {
        const asArticlePath = path.join(WORK_DIR, input, "output.md");
        if (!path.isAbsolute(input)) {
            return asArticlePath;
        }
        return input;
    }
    console.error(`✗ 无效的 article-path: ${input}`);
    console.error("  格式应为 <series>/<id>，如 yangxia-series/07");
    process.exit(1);
}

function parseArgs(argv: string[]): { file: string; envFile: string; extraArgs: string[] } {
    let fileArg = "";
    let envFile = ".env";
    const extraArgs: string[] = [];
    let i = 2;

    while (i < argv.length) {
        const arg = argv[i];
        if (arg === "--env" && i + 1 < argv.length) {
            envFile = argv[++i];
        } else if (!arg.startsWith("--") && !fileArg) {
            fileArg = arg;
        } else if (arg !== "--env") {
            extraArgs.push(arg);
        }
        i++;
    }

    if (!fileArg) {
        console.error("用法: pnpm publish:work <article-path> [--env .env文件] [wenyan 参数...]");
        console.error("示例:");
        console.error("  pnpm publish:work yangxia-series/07");
        console.error("  pnpm publish:work yangxia-series/07 --theme lapis");
        console.error("  pnpm publish:work yangxia-series/07 --env .env.test");
        process.exit(1);
    }

    const file = resolveOutputFile(fileArg);
    return { file, envFile, extraArgs };
}

async function ensureBuilt(): Promise<void> {
    const distCli = path.join(ROOT, "dist", "cli.js");
    try {
        await fs.access(distCli);
    } catch {
        console.log("正在构建...");
        await new Promise<void>((resolve, reject) => {
            const proc = spawn("pnpm", ["build"], {
                cwd: ROOT,
                stdio: "inherit",
                shell: true,
            });
            proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`build exited ${code}`))));
        });
    }
}

async function main() {
    const { file, envFile, extraArgs } = parseArgs(process.argv);

    const envPath = path.isAbsolute(envFile) ? envFile : path.join(ROOT, envFile);
    await loadEnv(envPath);

    if (!process.env.WECHAT_APP_ID || !process.env.WECHAT_APP_SECRET) {
        console.error("请配置微信公众号凭据。");
        console.error("方式一：复制 .env.example 为 .env，填入 WECHAT_APP_ID 和 WECHAT_APP_SECRET");
        console.error("方式二：使用 --env 指定配置文件，如 --env .env.test");
        process.exit(1);
    }

    try {
        await fs.access(file);
    } catch {
        console.error(`文件不存在: ${file}`);
        console.error("请先运行 pnpm convert <article-path> 生成 output.md");
        process.exit(1);
    }

    await ensureBuilt();

    const args = ["-f", file, ...extraArgs];
    const proc = spawn("node", [path.join(ROOT, "dist", "cli.js"), "publish", ...args], {
        cwd: ROOT,
        stdio: "inherit",
        env: process.env,
    });

    proc.on("exit", (code) => process.exit(code ?? 1));
}

main();
