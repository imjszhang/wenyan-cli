---
name: wenyan-cli-scripts
description: >-
  指导使用 wenyan-cli 项目 scripts 目录下的工具脚本。适用于 Markdown 文章转换、微信公众号发布、豆包 AI 图片生成、公众号封面图生成等场景。当用户提及 convert、publish、doubao、wechat cover、图片生成、文章转换或发布时使用。
---

# Wenyan-CLI 脚本工具

本技能说明 `scripts/` 目录下四个工具脚本的用途、调用方式及典型场景。

## 脚本概览

| 脚本 | 命令 | 用途 |
|------|------|------|
| convert.ts | `pnpm convert` | 将 work_dir 中的 Markdown 转为发布格式 |
| publish.ts | `pnpm publish:work` | 发布文章到微信公众号 |
| doubaoImageGenerator.ts | `pnpm doubao:gen` | 豆包 AI 图像生成 |
| wechatCoverGen.ts | `pnpm wechat:cover` | 生成微信公众号封面图 |

---

## 1. convert.ts - 文章转换

将 `work_dir/<id>.md` 转为 `work_dir/output/<id>.md`，自动提取标题、封面、替换图片占位符。

**用法：**
```bash
pnpm convert <编号> [--author 作者] [--source-url URL]
```

**示例：**
```bash
pnpm convert 01
pnpm convert 01 --author JS
pnpm convert 01 02 03 --author JS --source-url "https://example.com"
```

**输入要求：**
- 源文件：`work_dir/<id>.md`，正文需包含 `# 标题`
- 图片目录：`work_dir/<id>/`，支持 `.jpg/.jpeg/.png/.gif/.webp`
- 封面：`work_dir/<id>/cover.*`（可选）
- 正文中 `[图片]` 或 `图片` 占位符会按顺序替换为目录内图片

**输出：**
- `work_dir/output/<id>.md`，含 frontmatter（title、cover、author、source_url）

---

## 2. publish.ts - 发布到公众号

加载 `.env` 中的微信公众号凭据，调用 wenyan-cli 的 publish 命令发布文章。

**用法：**
```bash
pnpm publish:work <文件或编号> [--env .env文件] [wenyan 参数...]
```

**示例：**
```bash
pnpm publish:work 01
pnpm publish:work work_dir/output/01.md
pnpm publish:work 01 --theme lapis
pnpm publish:work 01 --env .env.test
```

**环境变量：**
- 需配置 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`（通过 `.env` 或 `--env` 指定）
- 短编号（如 `01`）会解析为 `work_dir/output/01.md`

**前置：**
- 若 `dist/cli.js` 不存在，会自动执行 `pnpm build`

---

## 3. doubaoImageGenerator.ts - 豆包 AI 图片生成

基于火山引擎豆包 AI 图像生成 API，支持文生图、图生图、批量生成、序列化生成。

**用法：**
```bash
pnpm doubao:gen --prompt "提示词" [选项]
```

**必需：**
- `--prompt <text>`：图片生成提示词
- API 密钥：`--api-key <key>` 或环境变量 `DOUBAO_API_KEY`（`pnpm doubao:gen` 会从 `.env` 加载）

**常用选项：**
| 选项 | 说明 | 默认 |
|------|------|------|
| `--count <n>` | 生成数量 (1-10) | 1 |
| `--size <1K\|2K\|4K>` | 尺寸 | 2K |
| `--sequential` | 序列化生成（多张相关图） | - |
| `--input-images <urls>` | 参考图 URL（逗号分隔） | - |
| `--config-file <file>` | 从 JSON 读取配置 | - |
| `--batch-file <file>` | 批量任务配置 | - |
| `--list-models` | 列出可用模型 | - |

**示例：**
```bash
pnpm doubao:gen --prompt "一只可爱的猫咪在花园里玩耍"
pnpm doubao:gen --prompt "科幻城市夜景" --count 3 --size 4K --sequential
pnpm doubao:gen --config-file ./image_config.json
pnpm doubao:gen --batch-file ./batch_images.json
```

**输出：**
- 默认目录：`work_dir/generated_images/<session_name>/`

---

## 4. wechatCoverGen.ts - 公众号封面图生成

基于 DoubaoImageGenerator 生成原图，再用 sharp 裁切为公众号封面规范尺寸。

**用法：**
```bash
pnpm wechat:cover --prompt "提示词" [选项]
```

**选项：**
| 选项 | 说明 | 默认 |
|------|------|------|
| `--type <main\|sub>` | main=首条(2.35:1)，sub=非首条(1:1) | main |
| `--output <path>` | 输出路径 | 自动生成 |
| `--keep-original` | 保留裁切前原图 | 不保留 |

**封面预设：**
- `main`：1068×455（首条封面 2.35:1）
- `sub`：800×800（非首条封面 1:1）

**示例：**
```bash
pnpm wechat:cover --prompt "赛博朋克风格的科技城市"
pnpm wechat:cover --prompt "可爱的猫咪" --type sub
pnpm wechat:cover --prompt "风景" --output ./my_cover.jpg --keep-original
```

**环境：**
- 需配置 `DOUBAO_API_KEY`（通过 `.env` 加载）

---

## 典型工作流

1. **写文章**：在 `work_dir/<id>.md` 写 Markdown，`[图片]` 占位符标记插图位置
2. **准备图片**：将图片放入 `work_dir/<id>/`，封面命名为 `cover.*`
3. **转换**：`pnpm convert <id>` 生成 `work_dir/output/<id>.md`
4. **生成封面**（可选）：`pnpm wechat:cover --prompt "..."`，将输出复制到 `work_dir/<id>/cover.jpg`
5. **发布**：`pnpm publish:work <id>`

---

## 环境配置

在项目根目录创建 `.env`（可参考 `.env.example`）：

```
DOUBAO_API_KEY=your-doubao-api-key
WECHAT_APP_ID=your-wechat-app-id
WECHAT_APP_SECRET=your-wechat-app-secret
```

`pnpm doubao:gen`、`pnpm wechat:cover`、`pnpm publish:work` 会通过 dotenv-cli 加载 `.env`。
