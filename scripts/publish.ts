import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const WORK_OUTPUT = path.join(ROOT, "work_dir", "output");

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

function parseArgs(argv: string[]): { file: string; envFile: string; extraArgs: string[] } {
    let file = "";
    let envFile = ".env";
    const extraArgs: string[] = [];
    let i = 2;

    while (i < argv.length) {
        const arg = argv[i];
        if (arg === "--env" && i + 1 < argv.length) {
            envFile = argv[++i];
        } else if (!arg.startsWith("--") && !file) {
            file = arg;
        } else if (arg !== "--env") {
            extraArgs.push(arg);
        }
        i++;
    }

    if (!file) {
        console.error("用法: pnpm publish:work <文件> [wenyan 参数...]");
        console.error("  或: pnpm publish:work 01 [--env .env.test]");
        console.error("");
        console.error("示例:");
        console.error("  pnpm publish:work 01");
        console.error("  pnpm publish:work work_dir/output/01.md");
        console.error("  pnpm publish:work 01 --theme lapis");
        console.error("  pnpm publish:work 01 --env .env.test");
        process.exit(1);
    }

    // 若为短编号（如 01），解析为 work_dir/output/01.md
    const resolvedFile =
        /^\d+$/.test(file) || (file.length <= 3 && /^\w+$/.test(file))
            ? path.join(WORK_OUTPUT, `${file}.md`)
            : path.isAbsolute(file)
              ? file
              : path.resolve(process.cwd(), file);

    return { file: resolvedFile, envFile, extraArgs };
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
