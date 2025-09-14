# 图片生成API接口文档

## 🚀 概述

本API提供统一的图片处理服务，支持原始URL处理和AI图片生成两种模式，具备自动降级机制。

**基础URL**: `https://your-worker.workers.dev`

## 🔑 认证

所有API请求（除公共端点外）需要在请求头中包含API密钥：

```http
Authorization: Bearer YOUR_API_KEY
```

## 📋 主要端点

### 1. 图片生成/处理 - `/images/generate`

**方法**: `POST`  
**描述**: 统一图片处理端点，支持原始URL处理和AI生成

#### 请求格式

```json
{
  "imageUrl": "string (可选)",
  "prompt": "string (可选)", 
  "articleId": "string (可选)",
  "provider": "string (可选)",
  "model": "string (可选)",
  "width": "number (可选, 默认1024)",
  "height": "number (可选, 默认768)"
}
```

#### 参数说明

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `imageUrl` | string | 否* | 原始图片URL，用于URL处理模式 |
| `prompt` | string | 否* | AI生成提示词，用于AI生成模式 |
| `articleId` | string | 否 | 文章ID，用于R2存储路径 |
| `provider` | string | 否 | 指定AI供应商：`replicate`、`fal`、`unsplash` |
| `model` | string | 否 | 指定AI模型（见下方模型列表） |
| `width` | number | 否 | 图片宽度，默认1024 |
| `height` | number | 否 | 图片高度，默认768 |

*注意：`imageUrl` 和 `prompt` 至少需要提供一个

#### 处理模式

1. **原始URL模式**: 提供 `imageUrl`，系统下载并存储到R2
2. **AI生成模式**: 提供 `prompt`，使用AI生成图片
3. **混合模式**: 同时提供 `imageUrl` 和 `prompt`，优先尝试URL，失败后降级到AI生成

## 🤖 AI供应商和模型

### Replicate Provider (`provider: "replicate"`)

| 模型名称 | 实际端点 | 描述 | 推荐用途 |
|----------|----------|------|----------|
| `flux-1.1-pro` | `black-forest-labs/flux-1.1-pro` | **默认推荐** - 最高质量 | 专业级图片生成 |
| `flux-1.1-dev` | `black-forest-labs/flux-dev` | 开发版本 | 测试和实验 |
| `flux-schnell` | `black-forest-labs/flux-schnell` | 快速生成 | 快速原型 |
| `ideogram-turbo` | `ideogram-ai/ideogram-v3-turbo` | Ideogram快速版 | 文字和图标 |
| `ideogram-3.0` | `ideogram-ai/ideogram-v2` | Ideogram标准版 | 高质量文字图片 |

### Fal.ai Provider (`provider: "fal"`)

| 模型名称 | 实际端点 | 描述 | 特殊参数 |
|----------|----------|------|----------|
| `flux-1.1-pro` | `fal-ai/flux-pro` | Flux.1 Pro (非1.1版本) | 28步推理 |
| `flux-1.1-dev` | `fal-ai/flux/dev` | Flux.1 Dev | 28步推理 |
| `flux-schnell` | `fal-ai/flux/schnell` | Flux Schnell | **4步推理** + acceleration |
| `ideogram-turbo` | `fal-ai/ideogram/v2/turbo` | Ideogram v2 Turbo | 快速生成 |
| `ideogram-3.0` | `fal-ai/ideogram/v3` | Ideogram v3 | 最新版本 |

**⚠️ Fal.ai尺寸限制**：
- **不支持自定义像素尺寸**（如1024x768）
- 必须使用预定义的枚举值：
  - `square` (512x512), `square_hd` (1024x1024)
  - `portrait_4_3` (768x1024), `portrait_16_9` (576x1024)
  - `landscape_4_3` (1024x768), `landscape_16_9` (1024x576)
- 系统会自动根据width/height参数选择最接近的枚举值

### Unsplash Provider (`provider: "unsplash"`)

- 提供免费的高质量库存图片
- 基于关键词搜索
- 无需模型参数

## 📝 请求示例

### 1. 原始URL处理

```bash
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "imageUrl": "https://example.com/image.jpg",
    "articleId": "article-123"
  }'
```

### 2. AI图片生成 - Replicate

```bash
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A futuristic cityscape at night",
    "provider": "replicate",
    "model": "flux-1.1-pro",
    "width": 1024,
    "height": 768,
    "articleId": "ai-image-001"
  }'
```

### 3. AI图片生成 - Fal.ai

```bash
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A beautiful sunset over mountains",
    "provider": "fal",
    "model": "flux-schnell",
    "articleId": "ai-image-002"
  }'
```

### 4. 自动供应商选择

```bash
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A cat sitting on a windowsill"
  }'
```

### 5. 混合模式（URL + AI备选）

```bash
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "imageUrl": "https://might-fail.com/image.jpg",
    "prompt": "A backup AI generated image",
    "provider": "replicate",
    "model": "flux-1.1-pro"
  }'
```

## 🎛️ 供应商和模型选择详解

### 改变供应商优先级的方法

#### 方法1: 强制指定供应商
```bash
# 强制使用Fal.ai（跳过默认的Replicate）
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A serene mountain lake",
    "provider": "fal",
    "model": "flux-1.1-pro"
  }'

# 强制使用Unsplash（跳过AI生成）
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "nature landscape",
    "provider": "unsplash"
  }'
```

#### 方法2: 只指定模型，让系统选择供应商
```bash
# 系统会选择支持flux-schnell的最佳供应商（通常是Fal.ai，因为更快）
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Quick concept art",
    "model": "flux-schnell"
  }'
```

#### 方法3: 完全自动选择（推荐）
```bash
# 使用默认优先级：Replicate → Fal.ai → Unsplash
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A professional headshot"
  }'
```

### 不同模型的具体使用示例

#### Flux 1.1 Pro - 最高质量
```bash
# Replicate版本（推荐，质量最高）
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A detailed oil painting of a sunset over the ocean",
    "provider": "replicate",
    "model": "flux-1.1-pro",
    "width": 1024,
    "height": 768
  }'

# Fal.ai版本（更快，但实际是Flux.1 Pro）
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A detailed oil painting of a sunset over the ocean",
    "provider": "fal",
    "model": "flux-1.1-pro"
    // 注意：不要指定width/height，Fal.ai会自动选择landscape_4_3
  }'
```

#### Flux Schnell - 最快速度
```bash
# Fal.ai版本（推荐，2-4秒生成）
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A simple sketch of a cat",
    "provider": "fal",
    "model": "flux-schnell"
  }'

# Replicate版本（5-10秒）
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A simple sketch of a cat",
    "provider": "replicate",
    "model": "flux-schnell",
    "width": 1024,
    "height": 1024
  }'
```

#### Ideogram - 文字和Logo
```bash
# 生成包含文字的图片
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Modern logo design with text \"ACME CORP\" in bold letters",
    "provider": "replicate",
    "model": "ideogram-turbo"
  }'

# 使用Fal.ai的Ideogram v3
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Vintage poster with text \"WELCOME HOME\"",
    "provider": "fal",
    "model": "ideogram-3.0"
  }'
```

### 场景化配置建议

#### 🚀 快速原型开发
```bash
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Concept art for mobile app icon",
    "provider": "fal",
    "model": "flux-schnell"
  }'
```

#### 🎨 生产环境高质量
```bash
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Professional product photography of a luxury watch",
    "provider": "replicate",
    "model": "flux-1.1-pro",
    "width": 1024,
    "height": 768
  }'
```

#### 💰 成本优化
```bash
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Simple illustration for blog post",
    "provider": "fal",
    "model": "flux-schnell"
  }'
```

#### 📝 文字内容
```bash
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Infographic title \"2024 TRENDS\" with modern typography",
    "model": "ideogram-turbo"
    // 不指定provider，让系统选择最佳的Ideogram实现
  }'
```

## 📤 响应格式

### 成功响应

```json
{
  "url": "https://your-r2-domain.com/path/to/image.jpg",
  "provider": "replicate",
  "elapsedMs": 5420,
  "success": true,
  "r2Stored": true,
  "source": "ai-generated",
  "originalUrl": "https://original-url.com/image.jpg",
  "usedPrompt": "A futuristic cityscape at night",
  "actualModel": "black-forest-labs/flux-1.1-pro"
}
```

### 响应字段说明

| 字段 | 类型 | 描述 |
|------|------|------|
| `url` | string | 最终图片URL（通常是R2存储URL） |
| `provider` | string | 实际使用的供应商 |
| `elapsedMs` | number | 处理耗时（毫秒） |
| `success` | boolean | 是否成功 |
| `r2Stored` | boolean | 是否已存储到R2 |
| `source` | string | 图片来源：`original`、`ai-generated`、`emergency-fallback` |
| `originalUrl` | string | 原始URL（如果有） |
| `usedPrompt` | string | 使用的提示词（如果有） |
| `actualModel` | string | 实际调用的模型端点（仅AI生成时） |

### 错误响应

```json
{
  "error": "Error message",
  "status": 400
}
```

## 🔄 自动降级机制

系统具备智能降级机制：

1. **URL处理失败** → 自动尝试AI生成（如果提供了prompt）
2. **指定供应商失败** → 按优先级尝试其他供应商
3. **所有AI供应商失败** → 使用Unsplash库存图片
4. **完全失败** → 返回紧急备用图片

### 🎯 默认供应商优先级

当不指定`provider`参数时，系统按以下优先级自动选择：

1. **🥇 Replicate** (默认首选)
   - 稳定性最高，模型更新及时
   - 支持webhook异步处理
   - 质量最佳但速度较慢

2. **🥈 Fal.ai** (备选)
   - 速度快，成本低
   - 直接调用，无需webhook
   - 有尺寸格式限制

3. **🥉 Unsplash** (最后备选)
   - 免费库存图片
   - 基于关键词搜索
   - 适合占位符使用

## 🎯 最佳实践

### 1. 模型选择建议

- **高质量需求**: 使用 `flux-1.1-pro` (Replicate)
- **快速生成**: 使用 `flux-schnell` (Fal.ai)
- **文字图片**: 使用 `ideogram-turbo` 或 `ideogram-3.0`
- **成本考虑**: Fal.ai通常比Replicate更便宜

### 2. 供应商选择

- **Replicate**: 稳定性好，模型更新及时，支持webhook，**系统默认首选**
- **Fal.ai**: 速度快，成本低，直接调用，**但有尺寸限制**
- **Unsplash**: 免费库存图片，适合占位符

### 3. Fal.ai尺寸注意事项

**❌ 错误用法**:
```json
{
  "provider": "fal",
  "width": 1024,
  "height": 768  // Fal.ai不支持自定义像素尺寸
}
```

**✅ 正确用法**:
```json
{
  "provider": "fal",
  "model": "flux-1.1-pro"
  // 系统会自动选择landscape_4_3 (1024x768)
}
```

**可用的Fal.ai尺寸枚举**:
- `square` (512x512) - 小正方形
- `square_hd` (1024x1024) - 高清正方形
- `portrait_4_3` (768x1024) - 竖版4:3
- `portrait_16_9` (576x1024) - 竖版16:9
- `landscape_4_3` (1024x768) - 横版4:3
- `landscape_16_9` (1024x576) - 横版16:9

### 3. 参数优化

```json
{
  "prompt": "详细的英文描述，避免中文",
  "width": 1024,
  "height": 768,
  "provider": "replicate",
  "model": "flux-1.1-pro"
}
```

## 🔧 其他端点

### 健康检查 - `/health`
**方法**: `GET`  
**描述**: 检查服务状态  
**认证**: 不需要

### R2测试 - `/test-r2`
**方法**: `POST`  
**描述**: 测试R2存储功能  
**认证**: 需要

### 图片访问 - `/images/r2`
**方法**: `GET`  
**参数**: `?key=path/to/image.jpg`  
**描述**: 直接访问R2存储的图片  
**认证**: 不需要

## 🔐 环境变量配置

确保在Cloudflare Workers中配置以下环境变量：

```bash
# 必需的API密钥
REPLICATE_API_TOKEN=your_replicate_token
FAL_KEY=your_fal_key
API_KEY=your_api_key

# 可选配置
UNSPLASH_ACCESS_KEY=your_unsplash_key
R2_CUSTOM_DOMAIN=your_custom_domain
WEBHOOK_SECRET=your_webhook_secret
```

## 📊 测试页面

访问 `https://your-worker.workers.dev/test` 查看交互式测试页面，可以测试所有功能。

## ⚠️ 错误处理

### 常见错误码

| 状态码 | 错误信息 | 原因 | 解决方案 |
|--------|----------|------|----------|
| 400 | `Missing imageUrl or prompt` | 未提供必需参数 | 至少提供 `imageUrl` 或 `prompt` |
| 401 | `Unauthorized - API key required` | API密钥无效 | 检查 `Authorization` 头 |
| 404 | `Not Found` | 端点不存在 | 检查URL路径 |
| 500 | `All AI providers failed` | 所有供应商都失败 | 检查API密钥和网络连接 |

### 调试信息

在Cloudflare Workers日志中查看详细调试信息：

```javascript
// 请求分析
console.log('Request analysis:', {
  hasImageUrl: !!body.imageUrl,
  hasPrompt: !!body.prompt,
  provider: body.provider,
  model: body.model
});

// 供应商调用
console.log('generateWithReplicate called with:', {
  prompt: request.prompt,
  model: request.model,
  hasToken: !!env.REPLICATE_API_TOKEN
});
```

## 🔍 故障排除

### 1. Fal.ai调用失败

**症状**: 返回 `emergency-fallback` 图片
**可能原因**:
- API密钥错误或过期
- 模型端点不存在
- 参数格式错误

**解决步骤**:
1. 检查 `FAL_KEY` 环境变量
2. 验证模型名称是否正确
3. 查看Workers日志中的详细错误

### 2. Replicate调用失败

**症状**: 长时间等待后失败
**可能原因**:
- Webhook配置问题
- API密钥权限不足
- 模型队列繁忙

**解决步骤**:
1. 检查 `REPLICATE_API_TOKEN` 环境变量
2. 确认webhook端点可访问
3. 尝试不同的模型

### 3. R2存储失败

**症状**: `r2Stored: false`
**可能原因**:
- R2 bucket权限问题
- 网络连接问题
- 图片格式不支持

**解决步骤**:
1. 检查R2 bucket配置
2. 验证图片URL可访问
3. 检查图片格式和大小

## 📈 性能优化

### 1. 响应时间对比

| 供应商 | 模型 | 平均响应时间 | 成本 |
|--------|------|--------------|------|
| Fal.ai | flux-schnell | 2-4秒 | 低 |
| Fal.ai | flux-1.1-pro | 8-15秒 | 中 |
| Replicate | flux-1.1-pro | 10-20秒 | 高 |
| Replicate | flux-schnell | 5-10秒 | 中 |

### 2. 优化建议

- **快速原型**: 使用 `fal` + `flux-schnell`
- **生产环境**: 使用 `replicate` + `flux-1.1-pro`
- **批量处理**: 考虑使用webhook模式
- **成本控制**: 优先使用Fal.ai

## 🔄 版本更新日志

### v2.0 (2025-09-14)
- ✅ 重构代码架构，减少87%代码量
- ✅ 升级默认模型为Flux 1.1 Pro
- ✅ 添加Fal.ai供应商支持
- ✅ 实现统一图片处理器
- ✅ 修复模型参数格式问题
- ✅ 优化错误处理和调试信息

### v1.x (历史版本)
- 基础图片生成功能
- Replicate集成
- R2存储支持

## 🛠️ 开发者工具

### 测试脚本

```bash
#!/bin/bash
# 测试脚本示例

API_URL="https://your-worker.workers.dev"
API_KEY="your-api-key"

# 测试原始URL处理
curl -X POST "$API_URL/images/generate" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"imageUrl": "https://picsum.photos/800/600.jpg", "articleId": "test-1"}'

# 测试AI生成
curl -X POST "$API_URL/images/generate" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "A beautiful landscape", "provider": "fal", "model": "flux-schnell"}'
```

### JavaScript SDK示例

```javascript
class ImageGeneratorAPI {
  constructor(baseUrl, apiKey) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  async generateImage(options) {
    const response = await fetch(`${this.baseUrl}/images/generate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(options)
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }

    return await response.json();
  }

  // 便捷方法
  async generateFromPrompt(prompt, options = {}) {
    return this.generateImage({
      prompt,
      provider: 'fal',
      model: 'flux-1.1-pro',
      ...options
    });
  }

  async processUrl(imageUrl, articleId) {
    return this.generateImage({
      imageUrl,
      articleId
    });
  }
}

// 使用示例
const api = new ImageGeneratorAPI('https://your-worker.workers.dev', 'your-api-key');

// AI生成
const result = await api.generateFromPrompt('A futuristic city');
console.log('Generated image:', result.url);

// URL处理
const urlResult = await api.processUrl('https://example.com/image.jpg', 'article-123');
console.log('Processed image:', urlResult.url);
```

---

**版本**: 2.0
**更新时间**: 2025-09-14
**支持**: 如有问题请检查Cloudflare Workers日志或查看测试页面进行调试
