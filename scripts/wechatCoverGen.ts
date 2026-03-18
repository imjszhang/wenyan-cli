#!/usr/bin/env node

/**
 * 微信公众号封面图生成工具
 *
 * 基于 DoubaoImageGenerator 生成原图，再用 sharp 裁切/缩放为微信公众号封面规范尺寸。
 *
 * 使用方法：
 *   pnpm wechat:cover --prompt "提示词"
 *   pnpm wechat:cover --prompt "提示词" --type sub
 *   pnpm wechat:cover --prompt "提示词" --output ./cover.jpg --keep-original
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import DoubaoImageGenerator from "./doubaoImageGenerator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, "..", "work_dir", "generated_images");

interface CoverPreset {
  ratio: number;
  width: number;
  height: number;
  label: string;
}

const PRESETS: Record<string, CoverPreset> = {
  main: { ratio: 2.35, width: 1068, height: 455, label: "首条封面 (2.35:1)" },
  sub:  { ratio: 1,    width: 800,  height: 800, label: "非首条封面 (1:1)" },
};

interface CliArgs {
  prompt: string | null;
  type: string;
  output: string | null;
  keepOriginal: boolean;
  inputImage: string | null;
  help: boolean;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const args: CliArgs = {
    prompt: null,
    type: "main",
    output: null,
    keepOriginal: false,
    inputImage: null,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--prompt":
        args.prompt = argv[++i] ?? null;
        break;
      case "--type":
        args.type = argv[++i] ?? "main";
        break;
      case "--output":
        args.output = argv[++i] ?? null;
        break;
      case "--keep-original":
        args.keepOriginal = true;
        break;
      case "--input-image":
        args.inputImage = argv[++i] ?? null;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        if (argv[i].startsWith("--")) {
          console.error(`❌ 未知选项: ${argv[i]}`);
          process.exit(1);
        }
    }
  }
  return args;
}

function showHelp(): void {
  const presetInfo = Object.entries(PRESETS)
    .map(([k, v]) => `  ${k.padEnd(6)} ${v.label}  →  ${v.width}x${v.height}`)
    .join("\n");

  console.log(`
🖼️  微信公众号封面图生成工具

📖 使用方法:
  pnpm wechat:cover --prompt "提示词" [选项]

🔧 参数:
  --prompt <text>      图片生成提示词（必需）
  --input-image <path> 参考图片路径（可选，用于图生图/多图融合）
  --type <main|sub>    封面类型（默认: main）
  --output <path>      输出文件路径（可选，默认自动生成）
  --keep-original      保留裁切前的原图（默认不保留）
  --help, -h           显示帮助信息

📐 封面预设:
${presetInfo}

📝 示例:
  pnpm wechat:cover --prompt "赛博朋克风格的科技城市"
  pnpm wechat:cover --prompt "可爱的猫咪" --type sub
  pnpm wechat:cover --prompt "风景" --output ./my_cover.jpg --keep-original
`);
}

async function cropAndResize(
  inputPath: string,
  outputPath: string,
  preset: CoverPreset,
): Promise<void> {
  const metadata = await sharp(inputPath).metadata();
  const srcW = metadata.width!;
  const srcH = metadata.height!;

  let extractW: number;
  let extractH: number;

  if (srcW / srcH > preset.ratio) {
    extractH = srcH;
    extractW = Math.round(srcH * preset.ratio);
  } else {
    extractW = srcW;
    extractH = Math.round(srcW / preset.ratio);
  }

  const left = Math.round((srcW - extractW) / 2);
  const top = Math.round((srcH - extractH) / 2);

  await sharp(inputPath)
    .extract({ left, top, width: extractW, height: extractH })
    .resize(preset.width, preset.height)
    .jpeg({ quality: 95 })
    .toFile(outputPath);
}

function rmDirSafe(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  if (!args.prompt) {
    console.error("❌ 必须提供 --prompt 参数");
    console.error("💡 使用 --help 查看使用说明");
    process.exit(1);
  }

  const preset = PRESETS[args.type];
  if (!preset) {
    console.error(`❌ 未知封面类型: ${args.type}。可选: ${Object.keys(PRESETS).join(", ")}`);
    process.exit(1);
  }

  console.log(`\n🖼️  微信公众号封面图生成`);
  console.log(`📐 类型: ${preset.label}`);
  console.log(`📏 目标尺寸: ${preset.width}x${preset.height}`);
  console.log(`📝 提示词: ${args.prompt}\n`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
  const sessionName = `wechat_cover_${timestamp}`;

  let inputImages: string[] = [];
  if (args.inputImage) {
    const inputPath = path.resolve(args.inputImage);
    if (!fs.existsSync(inputPath)) {
      console.error(`❌ 参考图片不存在: ${inputPath}`);
      process.exit(1);
    }
    const buf = fs.readFileSync(inputPath);
    const ext = path.extname(inputPath).toLowerCase().slice(1) || "jpeg";
    const mime = ext === "jpg" ? "jpeg" : ext;
    inputImages = [`data:image/${mime};base64,${buf.toString("base64")}`];
    console.log(`📎 已加载参考图片: ${inputPath}\n`);
  }

  const generator = new DoubaoImageGenerator({
    prompt: args.prompt,
    inputImages,
    size: "2K",
    count: 1,
    responseFormat: "url",
    outputDir: DEFAULT_OUTPUT_DIR,
    sessionName,
  });

  const result = await generator.execute();

  const originalImage = result.generatedImages.find((img) => img.filePath);
  if (!originalImage?.filePath) {
    console.error("❌ 图片生成失败，无法继续裁切");
    process.exit(1);
  }

  const originalPath = originalImage.filePath;

  const outputPath = args.output
    ? path.resolve(args.output)
    : path.join(
        DEFAULT_OUTPUT_DIR,
        sessionName,
        `cover_${args.type}_${preset.width}x${preset.height}.jpg`,
      );

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`\n✂️  裁切并缩放到 ${preset.width}x${preset.height}...`);
  await cropAndResize(originalPath, outputPath, preset);
  console.log(`✅ 封面图已保存: ${outputPath}`);

  if (!args.keepOriginal && result.sessionDir) {
    const sessionDir = result.sessionDir;
    if (path.dirname(outputPath) === sessionDir) {
      const filesToRemove = fs
        .readdirSync(sessionDir)
        .filter((f) => path.join(sessionDir, f) !== outputPath);
      for (const f of filesToRemove) {
        try { fs.unlinkSync(path.join(sessionDir, f)); } catch { /* skip */ }
      }
    } else {
      rmDirSafe(sessionDir);
    }
    console.log("🗑️  已清理原图临时文件");
  }

  console.log(`\n🎉 完成！封面图路径: ${outputPath}`);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((error) => {
    console.error("💥 未捕获的异常:", error);
    process.exit(1);
  });
}
