import fs from "node:fs/promises";
import path from "node:path";

const WORK_DIR = path.resolve(import.meta.dirname, "..", "work_dir");
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const DEFAULT_SERIES = "standalone";

interface ImportOptions {
    id?: string;
    series?: string;
    force?: boolean;
}

function parseArgs(argv: string[]): { sourcePath: string; options: ImportOptions } {
    let sourcePath = "";
    const options: ImportOptions = {};
    let i = 2;
    while (i < argv.length) {
        const arg = argv[i];
        if (arg === "--id" && i + 1 < argv.length) {
            options.id = argv[++i];
        } else if (arg === "--series" && i + 1 < argv.length) {
            options.series = argv[++i];
        } else if (arg === "--force") {
            options.force = true;
        } else if (!arg.startsWith("--") && !sourcePath) {
            sourcePath = arg;
        }
        i++;
    }
    if (!sourcePath) {
        console.error("用法: pnpm import <source-path> [--id <id>] [--series <series>] [--force]");
        console.error("示例: pnpm import d:\\docs\\07.md");
        console.error("      pnpm import ./article.md --series yangxia-series --id 07");
        process.exit(1);
    }
    const resolved = path.isAbsolute(sourcePath) ? sourcePath : path.resolve(process.cwd(), sourcePath);
    return { sourcePath: resolved, options };
}

function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    if (!match) return { frontmatter: "", body: raw };
    return { frontmatter: match[1], body: raw.slice(match[0].length) };
}

function extractField(fm: string, field: string): string | undefined {
    const m = fm.match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
    return m ? m[1].trim() : undefined;
}

function countPlaceholders(body: string): number {
    return (body.match(/^(\[图片\]|图片)$/gm) || []).length;
}

async function findImages(dir: string): Promise<string[]> {
    try {
        const entries = await fs.readdir(dir);
        return entries.filter((f) => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase())).sort();
    } catch {
        return [];
    }
}

async function main() {
    const { sourcePath, options } = parseArgs(process.argv);

    let raw: string;
    try {
        raw = await fs.readFile(sourcePath, "utf-8");
    } catch {
        console.error(`✗ 源文件不存在: ${sourcePath}`);
        process.exit(1);
    }

    const { frontmatter, body } = splitFrontmatter(raw);

    const id = options.id ?? path.parse(sourcePath).name;
    const series = options.series ?? extractField(frontmatter, "template") ?? DEFAULT_SERIES;
    const articlePath = `${series}/${id}`;
    const articleDir = path.join(WORK_DIR, series, id);
    const targetFile = path.join(articleDir, "source.md");

    console.log(`\n导入 ${articlePath} ...`);
    console.log(`  源: ${sourcePath}`);
    console.log(`  目标: ${path.relative(process.cwd(), targetFile)}`);
    console.log(`  系列: ${series}${options.series ? "" : frontmatter ? " (from template)" : " (default)"}`);

    try {
        await fs.access(targetFile);
        if (!options.force) {
            console.error(`  ✗ 目标已存在: ${path.relative(process.cwd(), targetFile)}`);
            console.error("    使用 --force 覆盖");
            process.exit(1);
        }
        console.log("  覆盖已有文件 (--force)");
    } catch {
        // target doesn't exist, ok
    }

    await fs.mkdir(articleDir, { recursive: true });
    await fs.copyFile(sourcePath, targetFile);

    const sourceDir = path.dirname(sourcePath);
    const searchDirs = [
        path.join(sourceDir, id),
        path.join(sourceDir, "images"),
        sourceDir,
    ];

    let copiedImages = 0;
    let hasCover = false;
    const seen = new Set<string>();

    for (const dir of searchDirs) {
        const images = await findImages(dir);
        for (const img of images) {
            if (seen.has(img)) continue;
            seen.add(img);
            const src = path.join(dir, img);
            const dest = path.join(articleDir, img);
            await fs.copyFile(src, dest);
            copiedImages++;
            if (path.parse(img).name.toLowerCase() === "cover") hasCover = true;
        }
        if (images.length > 0) break;
    }

    console.log(`  图片: ${copiedImages} 张`);

    const placeholders = countPlaceholders(body);
    const contentImages = copiedImages - (hasCover ? 1 : 0);
    if (placeholders > 0 && contentImages < placeholders) {
        console.log(`  ⚠ 正文有 ${placeholders} 个 [图片] 占位符，请准备配图到 ${path.relative(process.cwd(), articleDir)}/`);
    }
    if (!hasCover) {
        console.log("  ⚠ 未找到封面图，可用 pnpm wechat:cover 生成");
    }

    console.log("  ✓ 导入完成");
    console.log(`\n后续步骤:`);
    console.log(`  pnpm convert ${articlePath}`);
    console.log(`  pnpm publish:work ${articlePath}`);
}

main();
