import fs from "node:fs/promises";
import path from "node:path";

const WORK_DIR = path.resolve(import.meta.dirname, "..", "work_dir");
const OUTPUT_DIR = path.join(WORK_DIR, "output");

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

/** 无封面且正文无图片时，补充的默认头图（满足微信公众号发布要求） */
const FALLBACK_COVER_URL = "https://picsum.photos/800/450";

const TEMPLATE_AUTHOR_MAP: Record<string, string> = {
    "yangxia-series": "JS",
};

interface ConvertOptions {
    author?: string;
    sourceUrl?: string;
}

function parseArgs(argv: string[]): { ids: string[]; options: ConvertOptions } {
    const ids: string[] = [];
    const options: ConvertOptions = {};
    let i = 2;
    while (i < argv.length) {
        const arg = argv[i];
        if (arg === "--author" && i + 1 < argv.length) {
            options.author = argv[++i];
        } else if (arg === "--source-url" && i + 1 < argv.length) {
            options.sourceUrl = argv[++i];
        } else if (!arg.startsWith("--")) {
            ids.push(arg);
        }
        i++;
    }
    if (ids.length === 0) {
        console.error("用法: npx tsx scripts/convert.ts <编号> [--author 作者] [--source-url URL]");
        console.error("示例: npx tsx scripts/convert.ts 01 --author JS");
        process.exit(1);
    }
    return { ids, options };
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

async function collectImages(imageDir: string): Promise<{ cover: string | null; images: string[] }> {
    let entries: string[];
    try {
        entries = await fs.readdir(imageDir);
    } catch {
        return { cover: null, images: [] };
    }

    const imageFiles = entries
        .filter((f) => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()))
        .sort();

    const coverFile = imageFiles.find((f) => path.parse(f).name.toLowerCase() === "cover") ?? null;

    const contentImages = imageFiles.filter(
        (f) => path.parse(f).name.toLowerCase() !== "cover",
    );

    return { cover: coverFile, images: contentImages };
}

function hasImageInBody(body: string): boolean {
    return /!\[[^\]]*\]\([^)]+\)/.test(body) || /<img\s+[^>]*src\s*=\s*["'][^"']+["']/.test(body);
}

function replaceImagePlaceholders(body: string, imageDir: string, images: string[]): string {
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
            const imgPath = `./${imageDir}/${images[idx]}`;
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

async function convert(id: string, options: ConvertOptions) {
    const sourceFile = path.join(WORK_DIR, `${id}.md`);
    const imageDir = path.join(WORK_DIR, id);

    console.log(`\n转换 ${id}.md ...`);

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

    const { cover, images } = await collectImages(imageDir);

    let coverPath = cover ? `./${id}/${cover}` : undefined;
    const processedBody = replaceImagePlaceholders(bodyWithoutTitle, id, images);

    if (!coverPath && !hasImageInBody(processedBody)) {
        coverPath = FALLBACK_COVER_URL;
        console.log(`  封面: (无) → 已补充默认头图 ${FALLBACK_COVER_URL}`);
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

    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    const outputFile = path.join(OUTPUT_DIR, `${id}.md`);
    await fs.writeFile(outputFile, output, "utf-8");

    console.log(`  ✓ 输出: ${path.relative(process.cwd(), outputFile)}`);
}

async function main() {
    const { ids, options } = parseArgs(process.argv);
    for (const id of ids) {
        await convert(id, options);
    }
    console.log("\n完成。");
}

main();
