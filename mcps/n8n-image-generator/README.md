# n8n Image Generator MCP Server

专为 n8n 设计的 MCP 服务器，提供 AI 图像生成功能，支持 SSE 协议。

## 🌟 功能特性

- ✅ **完整的 n8n 集成**: 专门为 n8n 工作流设计
- 🔄 **SSE 协议支持**: 与 n8n 的 MCP Client Tool 完美配合
- 🎨 **多模型支持**: 支持 Flux、Stable Diffusion 等多种 AI 模型
- ⚡ **高性能**: 直接调用现有的 Cloudflare Worker API
- 🔒 **安全认证**: 支持 API Token 认证机制
- 📊 **状态跟踪**: 实时图像生成状态查询

## 🚀 快速开始

### 1. 安装依赖

```bash
cd mcps/n8n-image-generator
npm install
```

### 2. 配置环境变量

创建 `.env` 文件：

```bash
CLOUDFLARE_WORKERS_URL=https://your-worker.workers.dev
WORKER_API_TOKEN=your-api-token
# ⚠️ 重要：启用社区节点作为工具使用
N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true
```

**⚠️ 关键配置：** 如果您要在n8n的AI Agent中使用此MCP服务器，必须设置：
```bash
export N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true
```

### 3. 构建项目

```bash
npm run build
```

### 4. 启动服务器

**方式1：作为标准MCP服务器（推荐）**
```bash
npm start
```

**方式2：作为SSE服务器**
```bash
npm run start:sse
```

**开发模式：**
```bash
# 标准模式
npm run dev

# SSE模式
npm run dev:sse
```

## 🛠️ n8n 配置

### 方法 1: 作为命令行MCP服务器 (推荐)

在 n8n 的 MCP Client Tool 节点中：

**Connection Type**: `Command-line`
**Command**: `node`
**Arguments**: `/path/to/mcps/n8n-image-generator/dist/index.js`
**Environment Variables**: 
- `CLOUDFLARE_WORKERS_URL=https://your-worker.workers.dev`
- `WORKER_API_TOKEN=your-api-token`

### 方法 2: 通过 n8n 环境变量 (Docker)

如果使用Docker部署n8n，在 `docker-compose.yml` 中添加：

```yaml
version: '3'
services:
  n8n:
    image: n8nio/n8n
    environment:
      # MCP服务器环境变量 (使用MCP_前缀)
      - MCP_CLOUDFLARE_WORKERS_URL=https://your-worker.workers.dev
      - MCP_WORKER_API_TOKEN=your-api-token
      
      # ⚠️ 必需：启用社区节点作为工具
      - N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true
    ports:
      - "5678:5678"
    volumes:
      - ~/.n8n:/home/node/.n8n
```

### 方法 3: SSE 服务器模式 (高级)

如果需要运行为独立SSE服务器：

**SSE 端点**: `http://localhost:3000/sse`
**认证**: Bearer Token

## 🎯 可用工具

### 1. generate_image

生成 AI 图像并存储到 Cloudflare R2。

**参数:**
- `prompt` (必需): 图像生成的提示词
- `model` (可选): AI 模型，默认为 `black-forest-labs/flux-schnell`
- `version` (可选): 模型版本 ID

**支持的模型:**
- `black-forest-labs/flux-schnell` (默认，快速生成)
- `black-forest-labs/flux-dev` (高质量)
- `stability-ai/stable-diffusion-xl-base-1.0`

**示例:**
```json
{
  "prompt": "一只可爱的猫咪坐在彩虹色的云朵上",
  "model": "black-forest-labs/flux-schnell"
}
```

### 2. get_generation_status

查询图像生成任务的状态。

**参数:**
- `predictionId` (必需): 图像生成任务的预测 ID

## 📋 n8n 工作流示例

### 基础图像生成工作流

1. **触发器**: Manual Trigger 或 Webhook
2. **MCP Client Tool**: 
   - 工具: `generate_image`
   - 参数: `{ "prompt": "{{$json.prompt}}" }`
3. **Set Node**: 格式化输出结果

### AI 聊天机器人配图工作流

1. **Chat Trigger**: 接收用户消息
2. **AI Agent**: 分析用户需求
3. **MCP Client Tool**: 如果需要生成图像
4. **Respond to Chat**: 返回结果和图像

## 🔧 开发

### 本地开发

```bash
npm run dev
```

### 类型检查

```bash
npm run type-check
```

### 构建

```bash
npm run build
```

## 🏗️ 架构说明

```
n8n (MCP Client Tool) --SSE--> MCP Server --HTTP--> Cloudflare Worker ---> R2 Storage
                                    |                      |
                                    |                      |
                                    |                   Replicate API
                                    |
                              工具: generate_image
                                   get_generation_status
```

这种架构的优势：
- **简洁性**: n8n 无需了解 Cloudflare Worker 的具体实现
- **标准化**: 使用 MCP 协议，易于扩展和维护
- **复用性**: 现有的 Worker 无需修改，直接复用
- **可扩展性**: 可以轻松添加新的图像处理功能

## ⚙️ 环境变量

| 变量名 | 描述 | 必需 | 默认值 |
|--------|------|------|--------|
| `CLOUDFLARE_WORKERS_URL` | Cloudflare Worker URL | ✅ | - |
| `WORKER_API_TOKEN` | Worker API 认证令牌 | ✅ | - |

## 🐛 故障排除

### 常见问题

1. **连接失败**
   - 检查 `CLOUDFLARE_WORKERS_URL` 是否正确
   - 确认 Worker 服务正常运行

2. **认证失败**
   - 验证 `WORKER_API_TOKEN` 是否正确
   - 检查 Worker 的认证配置

3. **图像生成失败**
   - 检查 Replicate API Token 配置
   - 确认 R2 存储桶配置正确

### 日志调试

服务器会输出详细的日志信息：
- 🎨 图像生成开始
- ✅ 任务创建成功
- ❌ 错误信息

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 🔗 相关链接

- [n8n 文档](https://docs.n8n.io)
- [MCP 协议规范](https://modelcontextprotocol.io)
- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers) 