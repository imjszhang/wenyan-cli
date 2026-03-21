import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const WORK_DIR = path.resolve(import.meta.dirname, "..", "work_dir");
const CONFIG_FILENAME = "cover-config.json";

interface SeriesCoverPreset {
    template: string;
    tag: string;
    icon: string;
    scheme: string;
}

const SERIES_COVER_MAP: Record<string, SeriesCoverPreset> = {
    "yangxia-series": {
        template: "wechat-cover-claw",
        tag: "养虾日记",
        icon: "claw",
        scheme: "dark",
    },
};

interface CoverArgs {
    articlePath: string;
    gen: boolean;
}

function parseArgs(argv: string[]): CoverArgs {
    let articlePath = "";
    let gen = false;
    let i = 2;
    while (i < argv.length) {
        const arg = argv[i];
        if (arg === "--gen") {
            gen = true;
        } else if (!arg.startsWith("--") && !articlePath) {
            articlePath = arg;
        }
        i++;
    }
    if (!articlePath) {
        console.error("用法:");
        console.error("  pnpm cover <article-path>        生成 cover-config.json 模板");
        console.error("  pnpm cover <article-path> --gen   根据 config 生成封面图");
        console.error("");
        console.error("示例:");
        console.error("  pnpm cover yangxia-series/07");
        console.error("  pnpm cover yangxia-series/07 --gen");
        process.exit(1);
    }
    return { articlePath, gen };
}

function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    if (!match) return { frontmatter: "", body: raw };
    return { frontmatter: match[1], body: raw.slice(match[0].length) };
}

function extractTitle(body: string): string | null {
    const match = body.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : null;
}

function resolveTemplatesDir(): string {
    const envDir = process.env.JS_VI_TEMPLATES_DIR;
    if (envDir) {
        return path.isAbsolute(envDir) ? envDir : path.resolve(process.cwd(), envDir);
    }
    console.error("✗ 未设置 JS_VI_TEMPLATES_DIR 环境变量");
    console.error("  请在 .env 中添加: JS_VI_TEMPLATES_DIR=d:\\github\\my\\js-vi-templates-private");
    process.exit(1);
}

function buildCoverConfig(
    preset: SeriesCoverPreset,
    title: string,
    id: string,
    articleDir: string,
) {
    const issue = `Vol.${id.replace(/^0+/, "") || "0"}`;
    const coverOut = path.join(articleDir, "cover.png").replace(/\\/g, "/");
    const thumbOut = path.join(articleDir, "thumb.png").replace(/\\/g, "/");

    return {
        posters: [
            {
                template: preset.template,
                scheme: preset.scheme,
                size: "wechat-cover",
                content: {
                    title,
                    subtitle: "// TODO: 替换为副标题",
                    tag: preset.tag,
                    issue,
                    icon: preset.icon,
                },
                outputs: [
                    { format: "png", path: coverOut },
                ],
            },
            {
                template: preset.template,
                scheme: preset.scheme,
                size: "wechat-thumb",
                content: {
                    title,
                    subtitle: `// ${preset.tag} ${issue}`,
                    tag: preset.tag,
                    issue,
                    icon: preset.icon,
                },
                outputs: [
                    { format: "png", path: thumbOut },
                ],
            },
        ],
    };
}

async function initConfig(articlePath: string) {
    const parts = articlePath.split(/[/\\]/);
    if (parts.length < 2) {
        console.error(`✗ article-path 格式应为 <series>/<id>，如 yangxia-series/07`);
        process.exit(1);
    }
    const series = parts[0];
    const id = parts[parts.length - 1];
    const articleDir = path.join(WORK_DIR, articlePath);
    const configPath = path.join(articleDir, CONFIG_FILENAME);

    const preset = SERIES_COVER_MAP[series];
    if (!preset) {
        console.error(`✗ 系列 "${series}" 暂无封面模板配置`);
        console.error(`  当前支持: ${Object.keys(SERIES_COVER_MAP).join(", ")}`);
        process.exit(1);
    }

    const sourceFile = path.join(articleDir, "source.md");
    let title = "TODO: 替换为封面标题";
    try {
        const raw = await fs.readFile(sourceFile, "utf-8");
        const { body } = splitFrontmatter(raw);
        const extracted = extractTitle(body);
        if (extracted) title = extracted;
    } catch {
        console.warn(`  ⚠ 未找到 source.md，使用占位标题`);
    }

    const config = buildCoverConfig(preset, title, id, articleDir);

    await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");

    const relConfig = path.relative(process.cwd(), configPath);
    console.log(`\n✓ 已生成封面配置: ${relConfig}`);
    console.log(`\n请编辑以下字段:`);
    console.log(`  - posters[0].content.title    封面短标题（支持 \\n 换行）`);
    console.log(`  - posters[0].content.subtitle  封面副标题`);
    console.log(`  - posters[1].content.title    缩略图短标题`);
    console.log(`\n编辑完成后运行:`);
    console.log(`  pnpm cover ${articlePath} --gen`);
}

async function generate(articlePath: string) {
    const articleDir = path.join(WORK_DIR, articlePath);
    const configPath = path.join(articleDir, CONFIG_FILENAME);

    try {
        await fs.access(configPath);
    } catch {
        console.error(`✗ 配置文件不存在: ${path.relative(process.cwd(), configPath)}`);
        console.error(`  请先运行: pnpm cover ${articlePath}`);
        process.exit(1);
    }

    const templatesDir = resolveTemplatesDir();

    console.log(`\n生成封面 ${articlePath} ...`);
    console.log(`  模板目录: ${templatesDir}`);
    console.log(`  配置: ${path.relative(process.cwd(), configPath)}`);

    const jsViBin = path.join(templatesDir, "node_modules", ".bin", "js-vi");

    await new Promise<void>((resolve, reject) => {
        const proc = spawn(
            jsViBin,
            ["poster", "--templates-dir", templatesDir, "--config", configPath],
            { cwd: templatesDir, stdio: "inherit", shell: true },
        );
        proc.on("exit", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`js-vi poster exited with code ${code}`));
        });
        proc.on("error", (err) => reject(err));
    });

    console.log(`\n✓ 封面生成完成`);

    const coverFile = path.join(articleDir, "cover.png");
    const thumbFile = path.join(articleDir, "thumb.png");
    try {
        await fs.access(coverFile);
        console.log(`  封面: ${path.relative(process.cwd(), coverFile)}`);
    } catch { /* not generated */ }
    try {
        await fs.access(thumbFile);
        console.log(`  缩略图: ${path.relative(process.cwd(), thumbFile)}`);
    } catch { /* not generated */ }
}

async function main() {
    const { articlePath, gen } = parseArgs(process.argv);
    if (gen) {
        await generate(articlePath);
    } else {
        await initConfig(articlePath);
    }
}

main();
