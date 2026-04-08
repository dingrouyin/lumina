# lumina 仓库修复指南

## 修复内容概述

| 问题 | 修复方案 |
|------|---------|
| `.gitignore` 只有一行 `.vercel`，导致所有问题 | 重写为完整版 |
| `node_modules/` 被提交到 Git | 从追踪中移除 |
| `dist/` 构建产物被提交到 Git | 从追踪中移除 |
| `dist/dist/` 嵌套重复目录 | 直接删除 |
| `vercel_out.txt` 等临时日志文件 | 删除 + 加入 .gitignore |

## 使用步骤

1. 把 `fix.sh` 复制到你的 `lumina` 项目根目录
2. 在终端执行：

```bash
cd /你的项目路径/lumina
bash fix.sh
```

脚本会自动完成所有操作并推送到 GitHub。

## 执行后的 .gitignore 内容

```
# 依赖包（最重要！）
node_modules/

# 构建产物
dist/

# 环境变量
.env
.env.local
.env.production
.env.vercel

# Vercel 部署目录
.vercel

# 日志 & 临时文件
vercel_out.txt
vercel_out_cmd.txt
*.log

# TypeScript 编译日志
.tsc_output.txt
.tsc_output_utf8.txt
.tsc_plain.txt

# 系统文件
.DS_Store
Thumbs.db
```

## 关于 dist/ 和 Vercel 部署

`dist/` 加入 `.gitignore` 后，Vercel 不会受到影响。
Vercel 会在每次部署时自动在它的服务器上运行构建命令生成 `dist/`，
不依赖你提交的 `dist/` 文件夹。

当前 `vercel.json` 中的 `"outputDirectory": "dist"` 配置保持不变即可。

---

# Lumina AI 生图功能

## 功能概述

Lumina 现已集成 Google Vertex AI Imagen 3 生图能力，支持通过自然语言描述生成高质量图片。

**核心特性：**
- ✨ 基于 Google Imagen 3 Fast 模型
- 🎨 支持多种宽高比 (1:1, 16:9, 9:16, 4:3)
- ⚡ 快速生成（通常 5-15 秒）
- 🛡️ 商业级质量输出
- 🔒 SynthID 水印保护

## 环境变量配置

在 Vercel 项目设置中添加以下环境变量：

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `VERTEX_PROJECT_ID` | Google Cloud 项目 ID | `project-123456789` |
| `VERTEX_CLIENT_EMAIL` | Service Account 邮箱 | `your-service@project.iam.gserviceaccount.com` |
| `VERTEX_PRIVATE_KEY` | Service Account 私钥 | `-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQ...` |

## Google Cloud 设置步骤

### 1. 创建 Google Cloud 项目
```bash
# 如果还没有项目，可以创建一个
gcloud projects create your-project-name
```

### 2. 启用 Vertex AI API
```bash
gcloud services enable aiplatform.googleapis.com
```

### 3. 创建 Service Account
```bash
# 创建服务账号
gcloud iam service-accounts create lumina-worker \
  --description="Lumina AI Image Generation" \
  --display-name="Lumina Worker"

# 授予 Vertex AI User 角色
gcloud projects add-iam-policy-binding your-project-id \
  --member="serviceAccount:lumina-worker@your-project-id.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

### 4. 生成服务账号密钥
```bash
# 生成 JSON 密钥文件
gcloud iam service-accounts keys create key.json \
  --iam-account=lumina-worker@your-project-id.iam.gserviceaccount.com
```

### 5. 配置环境变量
将 `key.json` 中的内容分别设置为 Vercel 环境变量：
- `VERTEX_PROJECT_ID`: `key.json` 中的 `project_id`
- `VERTEX_CLIENT_EMAIL`: `key.json` 中的 `client_email`
- `VERTEX_PRIVATE_KEY`: `key.json` 中的 `private_key`

## 使用说明

1. **打开 Lumina 画布工具**
2. **点击工具栏中的魔法棒图标** (✨ AI 生图)
3. **输入图片描述**（最多 500 字符）
4. **选择宽高比**
5. **点击生成** 或按 `Ctrl+Enter`
6. **等待生成完成后自动插入画布**

## 注意事项

### 费用控制
- **免费额度**: Google Cloud 提供 $300 免费额度
- **建议设置**: 在 GCP 控制台设置月度消费上限（建议 $20/月）
- **监控**: 定期检查 GCP Billing 控制台

### 安全提醒
- 🔐 Service Account 密钥请妥善保管，不要提交到代码仓库
- 🚫 不要在客户端代码中暴露 API 密钥
- ⚠️ 生产环境使用时请启用双因素认证

### 技术限制
- ⏱️ 单次生成超时时间：30 秒
- 📝 Prompt 长度限制：500 字符
- 🎯 模型：Imagen 3 Fast (`imagegeneration@006`)
- 🌍 区域：固定使用 `us-central1`

### 常见问题

**Q: 生成失败，提示权限不足？**
A: 检查 Service Account 是否有 `Vertex AI User` 角色，且 Vertex AI API 已启用。

**Q: 图片生成很慢？**
A: Imagen 3 在 `us-central1` 区域响应较快，其他区域可能较慢。

**Q: 余额不足怎么办？**
A: 检查 GCP Billing 设置，确保有有效的支付方式，或等待免费额度重置。

## 技术架构

```
用户输入 Prompt
    ↓
前端 useImageGeneration Hook
    ↓
Vercel Serverless Function (/api/generate-image)
    ↓
Google Vertex AI Imagen 3 API
    ↓
返回 Base64 图片 → 插入画布
```

## 更新日志

- **2026-04-08**: 完成 Phase 1 基础生图功能
- **未来**: Phase 2-4 将支持局部生图、图生图等高级功能