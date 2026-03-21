---
name: wenyan-cli-scripts
description: >-
  指导使用 wenyan-cli 项目 scripts 目录下的工具脚本。适用于 Markdown 文章导入、转换、微信公众号发布、豆包 AI 图片生成、公众号封面图生成等场景。当用户提及 import、convert、publish、doubao、wechat cover、图片生成、文章转换或发布时使用。
---

# Wenyan-CLI 脚本工具

本技能说明 `scripts/` 目录下工具脚本的用途、调用方式及典型场景。

## 脚本概览

| 脚本 | 命令 | 用途 |
|------|------|------|
| import.ts | `pnpm import` | 将外部文章导入 work_dir 标准结构 |
| convert.ts | `pnpm convert` | 将导入的 Markdown 转为发布格式 |
| cover.ts | `pnpm cover` | 基于 js-vi 模板生成公众号封面图 |
| publish.ts | `pnpm publish:work` | 发布文章到微信公众号 |
| doubaoImageGenerator.ts | `pnpm doubao:gen` | 豆包 AI 图像生成 |
| wechatCoverGen.ts | `pnpm wechat:cover` | AI 生成公众号封面图（豆包） |

---

## work_dir 目录结构

每篇文章为一个自包含目录，按系列分组：

```
work_dir/
├── <series>/                  ← 系列目录（从 frontmatter template 自动推导）
│   └── <id>/                  ← 文章编号（从文件名推导）
│       ├── source.md          ← 导入的原始文件
│       ├── output.md          ← convert 生成的可发布版本
│       ├── cover-config.json  ← 封面配置（pnpm cover 生成）
│       ├── cover.png          ← 封面图（pnpm cover --gen 生成）
│       ├── thumb.png          ← 缩略图（pnpm cover --gen 生成）
│       └── 01.jpg, 02.jpg     ← 正文配图（按文件名排序替换占位符）
│
├── standalone/                ← 无系列的独立文章
│   └── <id>/
│       ├── source.md
│       └── output.md
│
├── generated_images/          ← AI 图片生成工作区
│   └── <session>/
│
└── archived/                  ← 历史存档
```

贯穿所有命令的统一标识：`article-path` = `<series>/<id>`，如 `yangxia-series/07`。

---

## 1. import.ts - 文章导入

将外部文章导入到 `work_dir/<series>/<id>/source.md`，自动检测系列、搜集图片。

**用法：**
```bash
pnpm import <source-path> [--id <id>] [--series <series>] [--force]
```

**参数：**
| 参数 | 说明 | 默认值 |
|------|------|--------|
| `<source-path>` | 外部文章路径 | 必填 |
| `--id <id>` | 文章编号 | 从文件名推导（`07.md` → `07`） |
| `--series <series>` | 系列名 | 从 frontmatter `template` 推导，无则 `standalone` |
| `--force` | 覆盖已有文章 | 不覆盖 |

**示例：**
```bash
pnpm import d:\docs\07.md
pnpm import ./article.md --series yangxia-series --id 07
pnpm import ./draft.md --force
```

**图片搜集：** 自动在源文件所在目录及同名子目录下查找图片文件，复制到文章目录。

---

## 2. cover.ts - 封面图生成（js-vi 模板）

基于 js-vi-templates-private 的 HTML/CSS/SVG 模板，生成公众号封面图和缩略图。分两步操作：先生成配置供编辑，再渲染图片。

**前置：** 需在 `.env` 中配置 `JS_VI_TEMPLATES_DIR` 指向 js-vi-templates-private 仓库路径。

**用法：**
```bash
# 第一步：生成 cover-config.json（自动预填标题、tag、issue）
pnpm cover <article-path>

# 第二步：编辑 cover-config.json 中的 title、subtitle

# 第三步：渲染封面图
pnpm cover <article-path> --gen
```

**示例：**
```bash
pnpm cover yangxia-series/07           # → work_dir/yangxia-series/07/cover-config.json
# 编辑 title 和 subtitle ...
pnpm cover yangxia-series/07 --gen     # → cover.png + thumb.png
```

**支持的系列：** 目前仅支持 `yangxia-series`（模板 `wechat-cover-claw`）。

**输出：**
- `cover.png`：公众号首条封面（900×383）
- `thumb.png`：公众号次条缩略图（500×500）

---

## 3. convert.ts - 文章转换

将 `work_dir/<series>/<id>/source.md` 转为同目录下的 `output.md`，自动提取标题、封面、替换图片占位符。

**用法：**
```bash
pnpm convert <article-path> [--author 作者] [--source-url URL]
```

**示例：**
```bash
pnpm convert yangxia-series/07
pnpm convert yangxia-series/01 yangxia-series/02 --author JS
pnpm convert standalone/my-article --source-url "https://example.com"
```

**输入要求：**
- 源文件：`work_dir/<article-path>/source.md`，正文需包含 `# 标题`
- 图片：同目录下的图片文件，支持 `.jpg/.jpeg/.png/.gif/.webp`
- 封面：同目录下 `cover.*`（可选）
- 正文中 `[图片]` 或 `图片` 占位符会按顺序替换为目录内图片

**输出：**
- `work_dir/<article-path>/output.md`，含 frontmatter（title、cover、author、source_url）

---

## 4. publish.ts - 发布到公众号

加载 `.env` 中的微信公众号凭据，调用 wenyan-cli 的 publish 命令发布文章。

**用法：**
```bash
pnpm publish:work <article-path> [--env .env文件] [wenyan 参数...]
```

**示例：**
```bash
pnpm publish:work yangxia-series/07
pnpm publish:work yangxia-series/07 --theme lapis
pnpm publish:work yangxia-series/07 --env .env.test
```

**环境变量：**
- 需配置 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`（通过 `.env` 或 `--env` 指定）

**前置：**
- 需先运行 `pnpm convert` 生成 `output.md`
- 若 `dist/cli.js` 不存在，会自动执行 `pnpm build`

---

## 5. doubaoImageGenerator.ts - 豆包 AI 图片生成

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

## 6. wechatCoverGen.ts - AI 封面图生成（豆包）

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
pnpm wechat:cover --prompt "风景" --output ./work_dir/yangxia-series/07/cover.jpg
```

**环境：**
- 需配置 `DOUBAO_API_KEY`（通过 `.env` 加载）

---

## 典型工作流

1. **导入文章**：`pnpm import <外部文章路径>`
2. **生成封面配置**：`pnpm cover <series>/<id>`，然后编辑 `cover-config.json` 中的标题和副标题
3. **渲染封面**：`pnpm cover <series>/<id> --gen`
4. **准备正文配图**（如有）：将图片放入 `work_dir/<series>/<id>/`
5. **转换**：`pnpm convert <series>/<id>` 生成 `output.md`
6. **发布**：`pnpm publish:work <series>/<id>`

**完整示例（养虾系列）：**
```bash
pnpm import d:\docs\07.md                   # → work_dir/yangxia-series/07/source.md
pnpm cover yangxia-series/07                # → cover-config.json（编辑 title/subtitle）
pnpm cover yangxia-series/07 --gen          # → cover.png + thumb.png
pnpm convert yangxia-series/07              # → output.md
pnpm publish:work yangxia-series/07         # → 公众号草稿箱
```

---

## 环境配置

在项目根目录创建 `.env`（可参考 `.env.example`）：

```
WECHAT_APP_ID=your-wechat-app-id
WECHAT_APP_SECRET=your-wechat-app-secret
DOUBAO_API_KEY=your-doubao-api-key
JS_VI_TEMPLATES_DIR=d:\github\my\js-vi-templates-private
```

| 变量 | 用途 | 需要的命令 |
|------|------|-----------|
| `WECHAT_APP_ID` / `WECHAT_APP_SECRET` | 公众号发布 | `pnpm publish:work` |
| `DOUBAO_API_KEY` | 豆包 AI 图片生成 | `pnpm doubao:gen`、`pnpm wechat:cover` |
| `JS_VI_TEMPLATES_DIR` | js-vi 模板封面生成 | `pnpm cover --gen` |
