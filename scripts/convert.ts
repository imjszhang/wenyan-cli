import fs from "node:fs/promises";
import path from "node:path";

const WORK_DIR = path.resolve(import.meta.dirname, "..", "work_dir");

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const NON_IMAGE_FILES = new Set(["source.md", "output.md"]);

const TEMPLATE_AUTHOR_MAP: Record<string, string> = {
    "yangxia-series": "JS",
};

interface ConvertOptions {
    author?: string;
    sourceUrl?: string;
}

function parseArgs(argv: string[]): { articlePaths: string[]; options: ConvertOptions } {
    const articlePaths: string[] = [];
    const options: ConvertOptions = {};
    let i = 2;
    while (i < argv.length) {
        const arg = argv[i];
        if (arg === "--author" && i + 1 < argv.length) {
            options.author = argv[++i];
        } else if (arg === "--source-url" && i + 1 < argv.length) {
            options.sourceUrl = argv[++i];
        } else if (!arg.startsWith("--")) {
            articlePaths.push(arg);
        }
        i++;
    }
    if (articlePaths.length === 0) {
        console.error("用法: pnpm convert <article-path> [--author 作者] [--source-url URL]");
        console.error("示例: pnpm convert yangxia-series/07");
        console.error("      pnpm convert yangxia-series/01 yangxia-series/02 --author JS");
        process.exit(1);
    }
    return { articlePaths, options };
}

function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    if (!match) return { frontmatter: "", body: raw };
    return {
        frontmatter: match[1],
        body: raw.slice(match[0].length),
    };
}

function extractFrontmatterField(fm: string, field: string): string | undefined {
    const re = new RegExp(`^${field}:\\s*(.+)$`, "m");
    const m = fm.match(re);
    return m ? m[1].trim() : undefined;
}

function extractTitle(body: string): { title: string; bodyWithoutTitle: string } | null {
    const match = body.match(/^(# .+)$/m);
    if (!match) return null;
    const title = match[1].replace(/^#\s+/, "").trim();
    const bodyWithoutTitle = body.replace(match[0], "").replace(/^\n+/, "");
    return { title, bodyWithoutTitle };
}

async function collectImages(articleDir: string): Promise<{ cover: string | null; images: string[] }> {
    let entries: string[];
    try {
        entries = await fs.readdir(articleDir);
    } catch {
        return { cover: null, images: [] };
    }

    const imageFiles = entries
        .filter((f) => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()) && !NON_IMAGE_FILES.has(f))
        .sort();

    const coverFile = imageFiles.find((f) => path.parse(f).name.toLowerCase() === "cover") ?? null;

    const contentImages = imageFiles.filter((f) => {
        const base = path.parse(f).name.toLowerCase();
        return base !== "cover" && base !== "thumb";
    });

    return { cover: coverFile, images: contentImages };
}

function hasImageInBody(body: string): boolean {
    return /!\[[^\]]*\]\([^)]+\)/.test(body) || /<img\s+[^>]*src\s*=\s*["'][^"']+["']/.test(body);
}

/** 与 output.md 同目录，故用 ./文件名（勿写 series/id 前缀，否则发布时路径会重复拼接） */
function replaceImagePlaceholders(body: string, images: string[]): string {
    const placeholderRe = /^(\[图片\]|图片)$/gm;
    let idx = 0;
    const totalPlaceholders = (body.match(placeholderRe) || []).length;

    if (totalPlaceholders === 0) return body;

    if (images.length === 0) {
        console.warn(`  ⚠ 找到 ${totalPlaceholders} 个图片占位符，但图片目录为空或不存在`);
        return body.replace(placeholderRe, "<!-- TODO: 补充图片 -->");
    }

    if (totalPlaceholders !== images.length) {
        console.warn(
            `  ⚠ 占位符数量 (${totalPlaceholders}) 与图片数量 (${images.length}) 不匹配`,
        );
    }

    return body.replace(placeholderRe, () => {
        if (idx < images.length) {
            const imgPath = `./${images[idx]}`;
            idx++;
            return `![](${imgPath})`;
        }
        return "<!-- TODO: 补充图片 -->";
    });
}

function buildFrontmatter(fields: Record<string, string | undefined>): string {
    const lines = ["---"];
    for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined && value !== "") {
            lines.push(`${key}: ${value}`);
        }
    }
    lines.push("---");
    return lines.join("\n");
}

async function convert(articlePath: string, options: ConvertOptions) {
    const articleDir = path.join(WORK_DIR, articlePath);
    const sourceFile = path.join(articleDir, "source.md");
    const outputFile = path.join(articleDir, "output.md");

    console.log(`\n转换 ${articlePath} ...`);

    let raw: string;
    try {
        raw = await fs.readFile(sourceFile, "utf-8");
    } catch {
        console.error(`  ✗ 源文件不存在: ${sourceFile}`);
        return;
    }

    const { frontmatter, body } = splitFrontmatter(raw);

    const extracted = extractTitle(body);
    if (!extracted) {
        console.error("  ✗ 无法从正文提取标题（未找到 # 标题）");
        return;
    }
    const { title, bodyWithoutTitle } = extracted;
    console.log(`  标题: ${title}`);

    const template = extractFrontmatterField(frontmatter, "template");
    const author =
        options.author ??
        (template ? TEMPLATE_AUTHOR_MAP[template] : undefined);

    const { cover, images } = await collectImages(articleDir);

    let coverPath = cover ? `./${cover}` : undefined;
    const processedBody = replaceImagePlaceholders(bodyWithoutTitle, images);

    if (!coverPath && !hasImageInBody(processedBody)) {
        console.warn(
            "  ⚠ 未找到本地封面（cover.jpg/png 等），且正文无可用内嵌图片。",
        );
        console.warn(
            "    微信公众号常无法使用随机外链作封面；请在本目录放入封面图，或执行：",
        );
        console.warn(`    pnpm cover ${articlePath}  → 编辑 cover-config.json  →  pnpm cover ${articlePath} --gen`);
        console.warn("    然后再运行 pnpm convert。");
    } else {
        console.log(`  封面: ${coverPath ?? "(无，将使用正文第一张图)"}`);
    }
    console.log(`  图片: ${images.length} 张`);

    const newFrontmatter = buildFrontmatter({
        title,
        cover: coverPath,
        author,
        source_url: options.sourceUrl,
    });

    const output = newFrontmatter + "\n\n" + processedBody;

    await fs.writeFile(outputFile, output, "utf-8");

    console.log(`  ✓ 输出: ${path.relative(process.cwd(), outputFile)}`);
}

async function main() {
    const { articlePaths, options } = parseArgs(process.argv);
    for (const ap of articlePaths) {
        await convert(ap, options);
    }
    console.log("\n完成。");
}

main();
