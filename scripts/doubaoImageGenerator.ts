#!/usr/bin/env node

/**
 * 豆包AI图像生成工具脚本
 * 基于火山引擎豆包AI图像生成API (doubao-seedream-4-0-250828)
 *
 * 功能：
 * - 支持单张和批量图片生成
 * - 支持文本到图像和图像到图像生成
 * - 支持序列化图像生成（生成多张相关图片）
 * - 提供完整的进程监控和错误处理机制
 * - 支持多种输出格式和尺寸
 * - 自动下载和保存生成的图片
 * - 支持会话管理和状态恢复
 *
 * 使用方法：
 * pnpm tsx scripts/doubaoImageGenerator.ts [选项]
 *
 * 选项：
 * --prompt <text>              图片生成提示词 (必需)
 * --api-key <key>              豆包AI API密钥 (必需)
 * --model <model>              使用的模型 (默认: doubao-seedream-4-0-250828)
 * --count <number>             生成图片数量 (默认: 1，最大: 10)
 * --size <size>                图片尺寸 (1K|2K|4K，默认: 2K)
 * --format <format>            响应格式 (url|base64，默认: url)
 * --input-images <urls>        输入参考图片URL列表 (逗号分隔)
 * --sequential                 启用序列化图像生成
 * --watermark                  添加水印 (默认: true)
 * --stream                     启用流式响应 (默认: true)
 * --output-dir <dir>           输出目录 (默认: ./generated_images)
 * --session-name <name>        会话名称 (用于管理生成任务)
 * --config-file <file>         从配置文件读取参数
 * --save-config <file>         保存当前配置到文件
 * --batch-file <file>          批量生成配置文件
 * --list-models                列出可用模型
 * --help                       显示帮助信息
 *
 * 示例：
 * pnpm tsx scripts/doubaoImageGenerator.ts --prompt "一只可爱的猫咪在花园里玩耍" --api-key "your-api-key"
 * pnpm tsx scripts/doubaoImageGenerator.ts --prompt "科幻城市夜景" --count 3 --size "4K" --sequential
 * pnpm tsx scripts/doubaoImageGenerator.ts --config-file "./image_config.json"
 * pnpm tsx scripts/doubaoImageGenerator.ts --batch-file "./batch_images.json"
 *
 * 创建时间: 2025-09-16
 * 版本: 1.0.0
 */

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { setupProxy } from "../src/proxy.js";

// 环境变量由 dotenv-cli 加载（运行: pnpm doubao:gen）或系统环境变量提供

declare global {
  var rootDir: string | undefined;
}

// 设置全局rootDir
global.rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 生成器配置 */
interface GeneratorConfig {
  apiUrl: string;
  apiKey: string | null;
  model: string;
  prompt: string | null;
  count: number;
  size: string;
  responseFormat: string;
  inputImages: string[];
  sequential: boolean;
  watermark: boolean;
  stream: boolean;
  outputDir: string;
  sessionName: string | null;
  timeout: number;
  retryCount: number;
  retryDelay: number;
}

/** API 生成选项 */
interface GeneratorOptions {
  apiKey?: string;
  model?: string;
  prompt?: string;
  count?: number;
  size?: string;
  responseFormat?: string;
  inputImages?: string[];
  sequential?: boolean;
  watermark?: boolean;
  stream?: boolean;
  outputDir?: string;
  sessionName?: string | null;
  timeout?: number;
  retryCount?: number;
  retryDelay?: number;
}

/** 流式响应中的单张图片 */
interface StreamImage {
  index: number;
  url: string;
  size?: string;
  created?: number;
}

/** 流式解析结果 */
interface StreamParseResult {
  images: StreamImage[];
  usage: unknown;
  completed: boolean;
}

/** 已生成图片信息 */
interface GeneratedImage {
  index: number;
  fileName: string;
  filePath: string | null;
  originalData: StreamImage;
  error?: string;
  savedAt: string;
}

/** 命令行解析选项 */
interface CliOptions {
  prompt: string | null;
  apiKey: string | null;
  model: string;
  count: number;
  size: string;
  responseFormat: string;
  inputImages: string[];
  sequential: boolean;
  watermark: boolean;
  stream: boolean;
  outputDir: string;
  sessionName: string | null;
  configFile: string | null;
  saveConfig: string | null;
  batchFile: string | null;
  listModels: boolean;
  help: boolean;
}

class DoubaoImageGenerator {
  config: GeneratorConfig;
  sessionDir: string | null = null;
  generatedImages: GeneratedImage[] = [];
  taskStatus = "pending";
  startTime: number | null = null;
  endTime: number | null = null;

  supportedModels = [
    "doubao-seedream-4-0-250828",
    "doubao-seedream-3-5",
    "doubao-seedream-3-0",
  ];

  supportedSizes = ["1K", "2K", "4K"];
  supportedFormats = ["url", "base64"];

  constructor(options: GeneratorOptions = {}) {
    this.config = {
      apiUrl: "https://ark.cn-beijing.volces.com/api/v3/images/generations",
      apiKey: options.apiKey || process.env.DOUBAO_API_KEY || null,
      model: options.model || "doubao-seedream-4-0-250828",
      prompt: options.prompt || null,
      count: options.count ?? 1,
      size: options.size || "2K",
      responseFormat: options.responseFormat || "url",
      inputImages: options.inputImages || [],
      sequential: options.sequential ?? false,
      watermark: options.watermark !== false,
      stream: options.stream !== false,
      outputDir: options.outputDir || "./work_dir/generated_images",
      sessionName: options.sessionName ?? null,
      timeout: options.timeout ?? 300000,
      retryCount: options.retryCount ?? 3,
      retryDelay: options.retryDelay ?? 2000,
    };

    this.validateConfig();
  }

  validateConfig(): void {
    console.log("🔍 验证配置参数...");

    if (!this.config.prompt) {
      throw new Error("❌ 必须提供图片生成提示词 (--prompt)");
    }

    if (!this.config.apiKey) {
      throw new Error(
        "❌ 必须提供豆包AI API密钥 (--api-key 或设置环境变量 DOUBAO_API_KEY)"
      );
    }

    if (!this.supportedModels.includes(this.config.model)) {
      throw new Error(
        `❌ 不支持的模型: ${this.config.model}。支持的模型: ${this.supportedModels.join(", ")}`
      );
    }

    if (this.config.count < 1 || this.config.count > 10) {
      throw new Error("❌ 图片数量必须在1-10之间");
    }

    if (!this.supportedSizes.includes(this.config.size)) {
      throw new Error(
        `❌ 不支持的尺寸: ${this.config.size}。支持的尺寸: ${this.supportedSizes.join(", ")}`
      );
    }

    if (!this.supportedFormats.includes(this.config.responseFormat)) {
      throw new Error(
        `❌ 不支持的格式: ${this.config.responseFormat}。支持的格式: ${this.supportedFormats.join(", ")}`
      );
    }

    console.log("✅ 配置验证通过");
  }

  initializeSession(): string {
    console.log("\n🚀 初始化生成会话...");

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .substring(0, 19);
    const sessionName =
      this.config.sessionName || `image_gen_${timestamp}`;

    this.sessionDir = path.join(this.config.outputDir, sessionName);

    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
      console.log(`📁 创建会话目录: ${this.sessionDir}`);
    }

    const sessionInfo = {
      sessionName,
      sessionDirectory: this.sessionDir,
      config: this.config,
      createdAt: new Date().toISOString(),
      status: "initialized",
    };

    const sessionInfoFile = path.join(this.sessionDir, "session_info.json");
    fs.writeFileSync(sessionInfoFile, JSON.stringify(sessionInfo, null, 2));

    console.log(`✅ 会话初始化完成: ${sessionName}`);
    return this.sessionDir;
  }

  buildRequestData(): Record<string, unknown> {
    console.log("📝 构建API请求数据...");

    const requestData: Record<string, unknown> = {
      model: this.config.model,
      prompt: this.config.prompt,
      response_format: this.config.responseFormat,
      size: this.config.size,
      stream: this.config.stream,
      watermark: this.config.watermark,
    };

    if (this.config.inputImages && this.config.inputImages.length > 0) {
      requestData.image = this.config.inputImages;
    }

    if (this.config.sequential && this.config.count > 1) {
      requestData.sequential_image_generation = "auto";
      requestData.sequential_image_generation_options = {
        max_images: this.config.count,
      };
    }

    const prompt = this.config.prompt ?? "";
    console.log("✅ 请求数据构建完成");
    console.log(`📊 模型: ${requestData.model}`);
    console.log(
      `📝 提示词: ${prompt.substring(0, 50)}${prompt.length > 50 ? "..." : ""}`
    );
    console.log(`📐 尺寸: ${requestData.size}`);
    console.log(`🔢 预期数量: ${this.config.count}`);

    return requestData;
  }

  async sendApiRequest(
    requestData: Record<string, unknown>
  ): Promise<StreamParseResult | { images: StreamImage[]; usage?: unknown }> {
    console.log("\n🌐 发送API请求...");

    return new Promise((resolve, reject) => {
      const postData = JSON.stringify(requestData);

      const options = {
        hostname: "ark.cn-beijing.volces.com",
        port: 443,
        path: "/api/v3/images/generations",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Length": Buffer.byteLength(postData),
        },
        timeout: this.config.timeout,
      };

      const req = https.request(options, (res) => {
        let responseData = "";

        console.log(`📡 响应状态: ${res.statusCode}`);

        if (res.statusCode !== 200) {
          reject(new Error(`API请求失败: HTTP ${res.statusCode}`));
          return;
        }

        res.on("data", (chunk: Buffer | string) => {
          responseData += chunk.toString();
        });

        res.on("end", () => {
          try {
            if (this.config.stream) {
              resolve(this.parseStreamResponse(responseData));
            } else {
              const jsonResponse = JSON.parse(responseData) as {
                images: StreamImage[];
                usage?: unknown;
              };
              resolve(jsonResponse);
            }
          } catch (error) {
            reject(
              new Error(
                `响应解析失败: ${error instanceof Error ? error.message : String(error)}`
              )
            );
          }
        });
      });

      req.on("error", (error) => {
        reject(new Error(`请求失败: ${error.message}`));
      });

      req.on("timeout", () => {
        req.destroy();
        reject(new Error("请求超时"));
      });

      req.write(postData);
      req.end();
    });
  }

  parseStreamResponse(responseData: string): StreamParseResult {
    console.log("📊 解析流式响应数据...");

    const lines = responseData.split("\n");
    const images: StreamImage[] = [];
    let completed = false;
    let usage: unknown = null;

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const dataStr = line.substring(6);

        if (dataStr === "[DONE]") {
          completed = true;
          continue;
        }

        try {
          const data = JSON.parse(dataStr) as {
            type: string;
            image_index?: number;
            url?: string;
            size?: string;
            created?: number;
            usage?: unknown;
          };

          if (data.type === "image_generation.partial_succeeded") {
            images.push({
              index: data.image_index ?? images.length,
              url: data.url ?? "",
              size: data.size,
              created: data.created,
            });
            console.log(`✅ 图片 ${(data.image_index ?? 0) + 1} 生成成功`);
          } else if (data.type === "image_generation.completed") {
            usage = data.usage;
            console.log(`📈 生成完成，使用统计: ${JSON.stringify(usage)}`);
          }
        } catch {
          console.warn(`⚠️ 解析数据行失败: ${dataStr}`);
        }
      }
    }

    return {
      images: images.sort((a, b) => a.index - b.index),
      usage,
      completed,
    };
  }

  async downloadImage(
    imageUrl: string,
    imagePath: string,
    imageIndex: number
  ): Promise<string> {
    console.log(
      `📥 下载图片 ${imageIndex + 1}: ${path.basename(imagePath)}`
    );

    return new Promise((resolve, reject) => {
      const protocol = imageUrl.startsWith("https:") ? https : http;

      const req = protocol.get(imageUrl, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`下载失败: HTTP ${res.statusCode}`));
          return;
        }

        const fileStream = fs.createWriteStream(imagePath);
        res.pipe(fileStream);

        fileStream.on("finish", () => {
          fileStream.close();
          console.log(
            `✅ 图片 ${imageIndex + 1} 下载完成: ${imagePath}`
          );
          resolve(imagePath);
        });

        fileStream.on("error", (error) => {
          fs.unlink(imagePath, () => {});
          reject(new Error(`文件写入失败: ${error.message}`));
        });
      });

      req.on("error", (error) => {
        reject(new Error(`下载请求失败: ${error.message}`));
      });

      req.setTimeout(this.config.timeout, () => {
        req.destroy();
        reject(new Error("下载超时"));
      });
    });
  }

  saveBase64Image(
    base64Data: string,
    imagePath: string,
    imageIndex: number
  ): string {
    console.log(
      `💾 保存Base64图片 ${imageIndex + 1}: ${path.basename(imagePath)}`
    );

    try {
      const base64Image = base64Data.replace(
        /^data:image\/[a-z]+;base64,/,
        ""
      );
      const imageBuffer = Buffer.from(base64Image, "base64");

      fs.writeFileSync(imagePath, imageBuffer);
      console.log(
        `✅ Base64图片 ${imageIndex + 1} 保存完成: ${imagePath}`
      );

      return imagePath;
    } catch (error) {
      throw new Error(
        `Base64图片保存失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  generateFileName(
    imageIndex: number,
    _imageData?: Partial<StreamImage>
  ): string {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .substring(0, 19);
    const index = (imageIndex + 1).toString().padStart(3, "0");
    const extension = "jpg";

    return `image_${index}_${timestamp}.${extension}`;
  }

  saveGenerationResult(
    result: StreamParseResult | { images: StreamImage[]; usage?: unknown }
  ): void {
    console.log("💾 保存生成结果...");

    const resultData = {
      sessionName: this.sessionDir ? path.basename(this.sessionDir) : null,
      config: this.config,
      result,
      generatedImages: this.generatedImages,
      taskStatus: this.taskStatus,
      startTime: this.startTime,
      endTime: this.endTime,
      duration:
        this.endTime && this.startTime ? this.endTime - this.startTime : null,
      savedAt: new Date().toISOString(),
    };

    const resultFile = path.join(
      this.sessionDir!,
      "generation_result.json"
    );
    fs.writeFileSync(resultFile, JSON.stringify(resultData, null, 2));

    console.log(`✅ 生成结果已保存: ${resultFile}`);
  }

  async generateWithRetry(): Promise<
    StreamParseResult | { images: StreamImage[]; usage?: unknown }
  > {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.retryCount; attempt++) {
      try {
        console.log(`\n🔄 尝试 ${attempt}/${this.config.retryCount}`);
        return await this.executeGeneration();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`❌ 尝试 ${attempt} 失败: ${lastError.message}`);

        if (attempt < this.config.retryCount) {
          console.log(
            `⏳ ${this.config.retryDelay / 1000} 秒后重试...`
          );
          await new Promise((resolve) =>
            setTimeout(resolve, this.config.retryDelay)
          );
        }
      }
    }

    throw lastError;
  }

  async executeGeneration(): Promise<
    StreamParseResult | { images: StreamImage[]; usage?: unknown }
  > {
    const requestData = this.buildRequestData();
    const response = await this.sendApiRequest(requestData);

    if (!response.images || response.images.length === 0) {
      throw new Error("API响应中未包含图片数据");
    }

    console.log(`\n📸 开始处理 ${response.images.length} 张图片...`);

    for (let i = 0; i < response.images.length; i++) {
      const imageData = response.images[i];
      const fileName = this.generateFileName(i, imageData);
      const imagePath = path.join(this.sessionDir!, fileName);

      try {
        let savedPath: string;

        if (this.config.responseFormat === "url") {
          savedPath = await this.downloadImage(
            imageData.url,
            imagePath,
            i
          );
        } else {
          savedPath = this.saveBase64Image(
            imageData.url,
            imagePath,
            i
          );
        }

        this.generatedImages.push({
          index: i,
          fileName,
          filePath: savedPath,
          originalData: imageData,
          savedAt: new Date().toISOString(),
        });
      } catch (error) {
        console.error(
          `❌ 处理图片 ${i + 1} 失败: ${error instanceof Error ? error.message : String(error)}`
        );

        this.generatedImages.push({
          index: i,
          fileName,
          filePath: null,
          originalData: imageData,
          error: error instanceof Error ? error.message : String(error),
          savedAt: new Date().toISOString(),
        });
      }
    }

    return response;
  }

  async execute(): Promise<{
    success: boolean;
    sessionDir: string | null;
    generatedImages: GeneratedImage[];
    statistics: {
      total: number;
      success: number;
      failed: number;
      duration: number;
    };
    usage?: unknown;
  }> {
    this.startTime = Date.now();
    console.log("\n🎨 开始豆包AI图片生成任务");
    console.log(`📝 提示词: ${this.config.prompt}`);
    console.log(`🔢 数量: ${this.config.count}`);
    console.log(`📐 尺寸: ${this.config.size}`);
    console.log(`🤖 模型: ${this.config.model}`);
    console.log(`⏰ 开始时间: ${new Date().toLocaleString("zh-CN")}`);

    try {
      this.initializeSession();

      this.taskStatus = "generating";
      const result = await this.generateWithRetry();

      this.taskStatus = "completed";
      this.endTime = Date.now();

      this.saveGenerationResult(result);

      const duration = this.endTime && this.startTime
        ? Math.round((this.endTime - this.startTime) / 1000)
        : 0;
      const successCount = this.generatedImages.filter(
        (img) => img.filePath
      ).length;
      const failedCount = this.generatedImages.filter(
        (img) => !img.filePath
      ).length;

      console.log("\n🎉 图片生成任务完成！");
      console.log(`⏱️  总耗时: ${duration} 秒`);
      console.log(`📁 输出目录: ${this.sessionDir}`);
      console.log(
        `📊 生成统计: 成功 ${successCount} 张，失败 ${failedCount} 张`
      );

      if (result.usage) {
        console.log(`💰 使用统计: ${JSON.stringify(result.usage)}`);
      }

      if (successCount > 0) {
        console.log("\n✅ 成功生成的图片:");
        this.generatedImages
          .filter((img) => img.filePath)
          .forEach((img, i) => {
            console.log(`   ${i + 1}. ${img.fileName}`);
          });
      }

      if (failedCount > 0) {
        console.log("\n❌ 失败的图片:");
        this.generatedImages
          .filter((img) => !img.filePath)
          .forEach((img, i) => {
            console.log(`   ${i + 1}. ${img.fileName}: ${img.error}`);
          });
      }

      return {
        success: true,
        sessionDir: this.sessionDir,
        generatedImages: this.generatedImages,
        statistics: {
          total: this.generatedImages.length,
          success: successCount,
          failed: failedCount,
          duration,
        },
        usage: result.usage,
      };
    } catch (error) {
      this.taskStatus = "failed";
      this.endTime = Date.now();

      console.error("\n❌ 图片生成任务失败:");
      console.error(
        `错误信息: ${error instanceof Error ? error.message : String(error)}`
      );
      console.error(`失败时间: ${new Date().toLocaleString("zh-CN")}`);

      if (this.sessionDir) {
        const failureInfo = {
          failed: true,
          error: error instanceof Error ? error.message : String(error),
          failedAt: new Date().toISOString(),
          config: this.config,
          generatedImages: this.generatedImages,
        };

        try {
          fs.writeFileSync(
            path.join(this.sessionDir, "generation_failed.json"),
            JSON.stringify(failureInfo, null, 2)
          );
        } catch (writeError) {
          console.error(
            `无法写入失败信息: ${writeError instanceof Error ? writeError.message : String(writeError)}`
          );
        }
      }

      throw error;
    }
  }

  static loadFromConfig(configFile: string): DoubaoImageGenerator {
    console.log(`📖 从配置文件加载参数: ${configFile}`);

    if (!fs.existsSync(configFile)) {
      throw new Error(`配置文件不存在: ${configFile}`);
    }

    try {
      const config = JSON.parse(
        fs.readFileSync(configFile, "utf-8")
      ) as GeneratorOptions;
      return new DoubaoImageGenerator(config);
    } catch (error) {
      throw new Error(
        `配置文件解析失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  saveConfig(configFile: string): void {
    console.log(`💾 保存配置到文件: ${configFile}`);

    const configData = {
      ...this.config,
      savedAt: new Date().toISOString(),
    };

    fs.writeFileSync(configFile, JSON.stringify(configData, null, 2));
    console.log(`✅ 配置已保存: ${configFile}`);
  }

  static async batchGenerate(
    batchFile: string
  ): Promise<
    Array<{
      taskIndex: number;
      success: boolean;
      result?: Awaited<ReturnType<DoubaoImageGenerator["execute"]>>;
      error?: string;
    }>
  > {
    console.log(`📋 开始批量图片生成: ${batchFile}`);

    if (!fs.existsSync(batchFile)) {
      throw new Error(`批量配置文件不存在: ${batchFile}`);
    }

    let batchConfig: {
      tasks: Array<GeneratorOptions & { sessionName?: string }>;
      defaults?: GeneratorOptions;
    };

    try {
      batchConfig = JSON.parse(fs.readFileSync(batchFile, "utf-8"));
    } catch (error) {
      throw new Error(
        `批量配置文件解析失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (!batchConfig.tasks || !Array.isArray(batchConfig.tasks)) {
      throw new Error("批量配置文件必须包含tasks数组");
    }

    const results: Array<{
      taskIndex: number;
      success: boolean;
      result?: Awaited<ReturnType<DoubaoImageGenerator["execute"]>>;
      error?: string;
    }> = [];

    for (let i = 0; i < batchConfig.tasks.length; i++) {
      const taskConfig = batchConfig.tasks[i];
      console.log(
        `\n🎯 执行批量任务 ${i + 1}/${batchConfig.tasks.length}`
      );

      try {
        const generator = new DoubaoImageGenerator({
          ...batchConfig.defaults,
          ...taskConfig,
          sessionName:
            taskConfig.sessionName || `batch_${i + 1}_${Date.now()}`,
        });

        const result = await generator.execute();
        results.push({
          taskIndex: i,
          success: true,
          result,
        });
      } catch (error) {
        console.error(
          `❌ 批量任务 ${i + 1} 失败: ${error instanceof Error ? error.message : String(error)}`
        );
        results.push({
          taskIndex: i,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failedCount = results.filter((r) => !r.success).length;

    console.log(
      `\n📊 批量生成完成: 成功 ${successCount} 个任务，失败 ${failedCount} 个任务`
    );

    return results;
  }

  static listModels(): void {
    console.log("\n🤖 支持的豆包AI图像生成模型:\n");

    const models = [
      {
        name: "doubao-seedream-4-0-250828",
        description: "豆包AI图像生成模型 4.0 (推荐)",
        features: ["高质量图像生成", "支持序列化生成", "支持图像到图像"],
      },
      {
        name: "doubao-seedream-3-5",
        description: "豆包AI图像生成模型 3.5",
        features: ["稳定的图像生成", "良好的文本理解"],
      },
      {
        name: "doubao-seedream-3-0",
        description: "豆包AI图像生成模型 3.0",
        features: ["基础图像生成功能"],
      },
    ];

    for (const model of models) {
      console.log(`🔹 ${model.name}`);
      console.log(`   描述: ${model.description}`);
      console.log(`   特性: ${model.features.join(", ")}`);
      console.log("");
    }
  }
}

function parseArguments(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    prompt: null,
    apiKey: null,
    model: "doubao-seedream-4-0-250828",
    count: 1,
    size: "2K",
    responseFormat: "url",
    inputImages: [],
    sequential: false,
    watermark: true,
    stream: true,
    outputDir: "./work_dir/generated_images",
    sessionName: null,
    configFile: null,
    saveConfig: null,
    batchFile: null,
    listModels: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case "--prompt":
        if (i + 1 < args.length) {
          options.prompt = args[++i];
        } else {
          throw new Error("❌ --prompt 需要指定提示词");
        }
        break;

      case "--api-key":
        if (i + 1 < args.length) {
          options.apiKey = args[++i];
        } else {
          throw new Error("❌ --api-key 需要指定API密钥");
        }
        break;

      case "--model":
        if (i + 1 < args.length) {
          options.model = args[++i];
        } else {
          throw new Error("❌ --model 需要指定模型名称");
        }
        break;

      case "--count":
        if (i + 1 < args.length) {
          options.count = parseInt(args[++i]);
          if (isNaN(options.count) || options.count < 1 || options.count > 10) {
            throw new Error("❌ --count 必须是1-10之间的整数");
          }
        } else {
          throw new Error("❌ --count 需要指定数量");
        }
        break;

      case "--size":
        if (i + 1 < args.length) {
          options.size = args[++i];
        } else {
          throw new Error("❌ --size 需要指定尺寸");
        }
        break;

      case "--format":
        if (i + 1 < args.length) {
          options.responseFormat = args[++i];
        } else {
          throw new Error("❌ --format 需要指定格式");
        }
        break;

      case "--input-images":
        if (i + 1 < args.length) {
          options.inputImages = args[++i]
            .split(",")
            .map((url) => url.trim());
        } else {
          throw new Error("❌ --input-images 需要指定图片URL列表");
        }
        break;

      case "--sequential":
        options.sequential = true;
        break;

      case "--no-watermark":
        options.watermark = false;
        break;

      case "--no-stream":
        options.stream = false;
        break;

      case "--output-dir":
        if (i + 1 < args.length) {
          options.outputDir = args[++i];
        } else {
          throw new Error("❌ --output-dir 需要指定目录路径");
        }
        break;

      case "--session-name":
        if (i + 1 < args.length) {
          options.sessionName = args[++i];
        } else {
          throw new Error("❌ --session-name 需要指定会话名称");
        }
        break;

      case "--config-file":
        if (i + 1 < args.length) {
          options.configFile = args[++i];
        } else {
          throw new Error("❌ --config-file 需要指定配置文件路径");
        }
        break;

      case "--save-config":
        if (i + 1 < args.length) {
          options.saveConfig = args[++i];
        } else {
          throw new Error("❌ --save-config 需要指定保存路径");
        }
        break;

      case "--batch-file":
        if (i + 1 < args.length) {
          options.batchFile = args[++i];
        } else {
          throw new Error("❌ --batch-file 需要指定批量配置文件路径");
        }
        break;

      case "--list-models":
        options.listModels = true;
        break;

      case "--help":
      case "-h":
        options.help = true;
        break;

      default:
        if (arg.startsWith("--")) {
          throw new Error(`❌ 未知选项: ${arg}`);
        }
        break;
    }
  }

  return options;
}

function showHelp(): void {
  console.log(`
🎨 豆包AI图像生成工具 v1.0.0

📖 使用方法:
  pnpm tsx scripts/doubaoImageGenerator.ts --prompt "提示词" --api-key "your-key" [选项]

🔧 必需参数:
  --prompt <text>              图片生成提示词 (必需)
  --api-key <key>              豆包AI API密钥 (可选，优先从环境变量DOUBAO_API_KEY获取)

🔧 可选参数:
  --model <model>              使用的模型 (默认: doubao-seedream-4-0-250828)
  --count <number>             生成图片数量 (默认: 1，最大: 10)
  --size <size>                图片尺寸 (1K|2K|4K，默认: 2K)
  --format <format>            响应格式 (url|base64，默认: url)
  --input-images <urls>        输入参考图片URL列表 (逗号分隔)
  --sequential                 启用序列化图像生成
  --no-watermark               禁用水印
  --no-stream                  禁用流式响应
  --output-dir <dir>           输出目录 (默认: ./work_dir/generated_images)
  --session-name <name>        会话名称 (用于管理生成任务)
  --config-file <file>         从配置文件读取参数
  --save-config <file>         保存当前配置到文件
  --batch-file <file>          批量生成配置文件
  --list-models                列出可用模型
  --help, -h                   显示帮助信息

📝 示例:
  # 基础图片生成 (使用环境变量中的API密钥)
  pnpm tsx scripts/doubaoImageGenerator.ts --prompt "一只可爱的猫咪在花园里玩耍"
  
  # 基础图片生成 (指定API密钥)
  pnpm tsx scripts/doubaoImageGenerator.ts --prompt "一只可爱的猫咪在花园里玩耍" --api-key "your-api-key"
  
  # 生成多张高质量图片
  pnpm tsx scripts/doubaoImageGenerator.ts --prompt "科幻城市夜景" --api-key "your-key" --count 3 --size "4K" --sequential
  
  # 基于参考图片生成
  pnpm tsx scripts/doubaoImageGenerator.ts --prompt "改变风格为油画" --api-key "your-key" \\
    --input-images "https://example.com/image1.jpg,https://example.com/image2.jpg"
  
  # 使用配置文件
  pnpm tsx scripts/doubaoImageGenerator.ts --config-file "./image_config.json"
  
  # 批量生成
  pnpm tsx scripts/doubaoImageGenerator.ts --batch-file "./batch_images.json"
  
  # 保存配置
  pnpm tsx scripts/doubaoImageGenerator.ts --prompt "测试" --api-key "key" --save-config "./my_config.json"

🤖 支持的模型:
  - doubao-seedream-4-0-250828 (推荐)
  - doubao-seedream-3-5
  - doubao-seedream-3-0

📐 支持的尺寸:
  - 1K: 1024x1024
  - 2K: 2048x2048 (推荐)
  - 4K: 4096x4096

💡 提示:
  - API密钥可以从火山引擎控制台获取
  - 序列化生成可以生成相关联的多张图片
  - 使用配置文件可以方便地管理复杂的生成任务
  - 批量模式支持一次性执行多个不同的生成任务
  - 生成的图片会自动保存到指定的输出目录
`);
}

async function main(): Promise<void> {
  try {
    await setupProxy();
    const options = parseArguments();

    if (options.help) {
      showHelp();
      process.exit(0);
    }

    if (options.listModels) {
      DoubaoImageGenerator.listModels();
      process.exit(0);
    }

    if (options.batchFile) {
      await DoubaoImageGenerator.batchGenerate(options.batchFile);
      process.exit(0);
    }

    let generator: DoubaoImageGenerator;
    if (options.configFile) {
      generator = DoubaoImageGenerator.loadFromConfig(options.configFile);
    } else {
      if (!options.prompt) {
        console.error("❌ 必须提供图片生成提示词 (--prompt)");
        console.error("💡 使用 --help 查看使用说明");
        process.exit(1);
      }

      const apiKey = options.apiKey || process.env.DOUBAO_API_KEY;
      if (!apiKey) {
        console.error("❌ 必须提供豆包AI API密钥");
        console.error("💡 方法1: 使用命令行参数 --api-key \"your-key\"");
        console.error("💡 方法2: 设置环境变量 DOUBAO_API_KEY");
        console.error("💡 使用 --help 查看使用说明");
        process.exit(1);
      }

      generator = new DoubaoImageGenerator(options);
    }

    if (options.saveConfig) {
      generator.saveConfig(options.saveConfig);
    }

    await generator.execute();
    process.exit(0);
  } catch (error) {
    console.error(
      `\n💥 程序异常退出: ${error instanceof Error ? error.message : String(error)}`
    );

    if (
      error instanceof Error &&
      (error.message.includes("未知选项") || error.message.includes("需要指定"))
    ) {
      console.error("💡 使用 --help 查看使用说明");
    }

    process.exit(1);
  }
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

export default DoubaoImageGenerator;
