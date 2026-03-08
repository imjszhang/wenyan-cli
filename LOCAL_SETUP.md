# 文颜 CLI 本地部署指南

## 1. 安装依赖

```bash
pnpm install
```

## 2. 配置微信公众号凭证

编辑项目根目录下的 `.env` 文件，填入你的凭证：

```env
WECHAT_APP_ID=你的AppID
WECHAT_APP_SECRET=你的AppSecret
```

**获取方式**：登录 [微信公众平台](https://mp.weixin.qq.com/) → 开发 → 基本配置 → 开发者 ID(AppID) / 开发者密码(AppSecret)

> ⚠️ 请勿将 `.env` 提交到 Git，该文件已加入 `.gitignore`

## 3. 配置 IP 白名单（本地直连模式必做）

若使用**本地直连**发布（`wenyan publish -f article.md`），需将运行机器的公网 IP 加入公众号白名单：

- 微信公众平台 → 开发 → 基本配置 → IP 白名单
- 配置说明：<https://yuzhi.tech/docs/wenyan/upload>

若使用 **Server 模式**，只需在部署 Server 的机器上配置白名单即可。

## 4. 构建项目

```bash
pnpm build
```

## 5. 使用方式

### 方式一：本地直连发布

直接发布到公众号草稿箱（需配置 IP 白名单）：

```bash
# 使用 dotenv 加载 .env 后执行
pnpm dotenv -e .env -- node ./dist/cli.js publish -f 你的文章.md

# 或先设置环境变量再执行（Windows PowerShell）
$env:WECHAT_APP_ID="你的AppID"
$env:WECHAT_APP_SECRET="你的AppSecret"
node ./dist/cli.js publish -f 你的文章.md
```

### 方式二：启动 Server（推荐，可绕过 IP 白名单）

在固定 IP 的服务器上启动 Server，本地通过 Server 发布：

```bash
# 启动 Server（默认端口 3000）
pnpm start

# 带 API 鉴权启动
pnpm dotenv -e .env -- node ./dist/cli.js serve --api-key 你的密钥
```

客户端发布：

```bash
node ./dist/cli.js publish -f 你的文章.md --server http://localhost:3000 --api-key 你的密钥
```

### 方式三：仅渲染 HTML（不发布）

```bash
node ./dist/cli.js render -f 你的文章.md
```

## 6. 文章格式要求

Markdown 顶部需包含 frontmatter：

```md
---
title: 文章标题（必填）
cover: ./封面图.jpg
author: 作者名
source_url: https://原文链接
---

正文内容...
```

示例文章见 `tests/publish.md`。

## 7. 常见问题

| 问题 | 解决方案 |
|------|----------|
| `invalid ip` | 将当前机器 IP 加入公众号白名单，或使用 Server 模式 |
| `invalid appid or secret` | 检查 `.env` 中的 `WECHAT_APP_ID` 和 `WECHAT_APP_SECRET` 是否正确 |
| 图片上传失败 | 确认图片路径正确，支持本地绝对路径、相对路径、网络 URL |
