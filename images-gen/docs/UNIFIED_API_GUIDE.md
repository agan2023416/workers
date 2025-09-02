# 统一图片处理API使用指南

## 概述

统一图片处理API是对原有图片生成服务的重大升级，现在支持两种处理模式：

1. **原文URL图片下载** → 验证 → 存储到R2 → 返回CDN地址
2. **AI图片生成** → 存储到R2 → 返回CDN地址（原有三级fallback机制）

关键特性：
- ✅ **智能降级**：原文URL失败时自动降级到AI生成
- ✅ **向后兼容**：所有现有API调用继续正常工作
- ✅ **统一存储**：所有图片都存储在R2中，返回永久CDN链接
- ✅ **详细日志**：完整的处理步骤追踪和错误报告

## API端点

**POST** `/images/generate`

## 请求格式

### 基础结构

```typescript
interface UnifiedImageRequest {
  // 新增：原文图片URL（可选）
  imageUrl?: string;
  
  // 原有：AI生成提示词（可选，当imageUrl失败时使用）
  prompt?: string;
  
  // 原有：可选参数
  provider?: 'replicate' | 'fal' | 'unsplash';
  articleId?: string;
  keyword?: string;
  width?: number;
  height?: number;
  style?: string;
}
```

### 参数说明

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `imageUrl` | string | 否* | 原文图片URL，支持HTTP/HTTPS协议 |
| `prompt` | string | 否* | AI生成提示词，当imageUrl失败时使用 |
| `articleId` | string | 否 | 文章ID，用于组织存储路径 |
| `provider` | string | 否 | 指定AI提供商：replicate, fal, unsplash |
| `keyword` | string | 否 | 额外关键词，用于AI生成 |
| `width` | number | 否 | 图片宽度（AI生成时使用） |
| `height` | number | 否 | 图片高度（AI生成时使用） |
| `style` | string | 否 | 图片风格（AI生成时使用） |

**\*注意**：`imageUrl` 和 `prompt` 至少需要提供一个。

### URL验证规则

原文URL必须满足以下条件：
- ✅ 使用HTTP或HTTPS协议
- ✅ 指向公网可访问的地址
- ✅ 返回有效的图片Content-Type
- ✅ 文件大小不超过10MB
- ✅ 支持的格式：JPEG, PNG, WebP, GIF, SVG, BMP, TIFF, AVIF

❌ 不支持的URL：
- 本地地址：localhost, 127.0.0.1
- 私有网络：192.168.x.x, 10.x.x.x, 172.16-31.x.x
- 非HTTP协议：FTP, file://, data:// 等

## 响应格式

### 成功响应

```json
{
  "url": "https://cdn.example.com/articles/article-123/2025/09/uuid.webp",
  "source": "original",
  "elapsedMs": 1200,
  "success": true,
  "r2Stored": true,
  "originalUrl": "https://example.com/original-image.jpg",
  "usedPrompt": null,
  "provider": "original"
}
```

### 失败响应

```json
{
  "url": "https://via.placeholder.com/1024x768/4A90E2/FFFFFF?text=Default+Image",
  "source": "emergency-fallback",
  "elapsedMs": 15000,
  "success": false,
  "r2Stored": false,
  "error": "Original URL validation failed and AI generation failed",
  "details": {
    "originalUrlError": "Invalid content type: text/html",
    "aiGenerationError": "All AI providers failed: timeout",
    "r2StorageError": null
  }
}
```

### 响应字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `url` | string | 最终图片URL（始终为R2 CDN地址或fallback地址） |
| `source` | string | 图片来源：original, replicate, fal, unsplash, emergency-fallback |
| `elapsedMs` | number | 总处理时间（毫秒） |
| `success` | boolean | 处理是否成功 |
| `r2Stored` | boolean | 是否成功存储到R2 |
| `originalUrl` | string | 原文URL（当source=original时） |
| `usedPrompt` | string | 使用的AI提示词（当使用AI生成时） |
| `provider` | string | 兼容字段，映射source到旧格式 |
| `error` | string | 错误信息（失败时） |
| `details` | object | 详细错误信息（失败时） |

## 使用示例

### 示例1：仅处理原文URL

```bash
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "imageUrl": "https://example.com/photo.jpg",
    "articleId": "article-123"
  }'
```

**预期结果**：
- 成功：`source="original"`，返回R2存储的图片URL
- 失败：`source="emergency-fallback"`，返回默认图片URL

### 示例2：原文URL + AI备选

```bash
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "imageUrl": "https://example.com/photo.jpg",
    "prompt": "A beautiful landscape with mountains",
    "articleId": "article-123"
  }'
```

**预期结果**：
- 原文URL成功：`source="original"`
- 原文URL失败：`source="replicate|fal|unsplash"`，使用AI生成

### 示例3：仅AI生成（向后兼容）

```bash
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A futuristic cityscape at sunset",
    "provider": "fal",
    "articleId": "article-123"
  }'
```

**预期结果**：
- 与原有API完全相同的行为
- `source="fal"`，使用指定的AI提供商

### 示例4：JavaScript集成

```javascript
class UnifiedImageAPI {
  constructor(apiKey, baseUrl) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async processImage(options) {
    const response = await fetch(`${this.baseUrl}/images/generate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(options)
    });

    const result = await response.json();
    
    if (result.success) {
      console.log(`Image processed successfully via ${result.source}`);
      console.log(`Final URL: ${result.url}`);
      
      if (result.originalUrl) {
        console.log(`Original URL: ${result.originalUrl}`);
      }
      
      if (result.usedPrompt) {
        console.log(`AI Prompt: ${result.usedPrompt}`);
      }
    } else {
      console.error(`Processing failed: ${result.error}`);
      console.error('Details:', result.details);
    }

    return result;
  }

  // 处理原文URL
  async processOriginalImage(imageUrl, articleId) {
    return this.processImage({ imageUrl, articleId });
  }

  // 原文URL + AI备选
  async processWithFallback(imageUrl, prompt, articleId) {
    return this.processImage({ imageUrl, prompt, articleId });
  }

  // 仅AI生成
  async generateImage(prompt, provider, articleId) {
    return this.processImage({ prompt, provider, articleId });
  }
}

// 使用示例
const api = new UnifiedImageAPI('your-api-key', 'https://your-worker.workers.dev');

// 处理原文图片
const result1 = await api.processOriginalImage(
  'https://example.com/photo.jpg', 
  'article-123'
);

// 原文图片 + AI备选
const result2 = await api.processWithFallback(
  'https://example.com/photo.jpg',
  'A beautiful landscape',
  'article-123'
);

// 纯AI生成
const result3 = await api.generateImage(
  'A futuristic cityscape',
  'fal',
  'article-123'
);
```

## 处理流程

### 流程图

```
请求 → 参数验证 → 处理路径选择
                    ↓
        ┌─────────────────────────────┐
        ↓                             ↓
   有imageUrl                    仅有prompt
        ↓                             ↓
   URL验证 → 下载图片              AI生成图片
        ↓         ↓                   ↓
      成功       失败                成功/失败
        ↓         ↓                   ↓
   存储R2    有prompt?              存储R2
        ↓         ↓                   ↓
   返回结果   AI生成备选            返回结果
                ↓
           存储R2 → 返回结果
```

### 详细步骤

1. **参数验证**
   - 检查imageUrl和prompt至少提供一个
   - 验证URL格式（如果提供）
   - 验证prompt非空（如果提供）

2. **URL处理**（如果提供imageUrl）
   - URL格式验证
   - HTTP HEAD请求检查
   - Content-Type验证
   - 文件大小检查
   - 图片下载

3. **AI生成**（如果URL失败或仅提供prompt）
   - 按优先级尝试提供商：Replicate → Fal → Unsplash
   - 每个提供商都有独立的超时和重试机制
   - 记录每次尝试的结果

4. **R2存储**
   - 将成功获取的图片存储到R2
   - 生成CDN URL
   - 记录存储元数据

5. **响应生成**
   - 构建统一响应格式
   - 记录处理日志
   - 返回结果给客户端

## 错误处理

### 错误分类

| 错误类型 | 错误代码 | 可重试 | 说明 |
|----------|----------|--------|------|
| URL验证错误 | `URL_VALIDATION_FAILED` | ❌ | URL格式错误、协议不支持等 |
| 下载错误 | `DOWNLOAD_FAILED` | ✅ | 网络错误、HTTP错误等 |
| AI生成错误 | `AI_GENERATION_FAILED` | ✅ | 所有AI提供商都失败 |
| R2存储错误 | `R2_STORAGE_FAILED` | ✅ | R2存储失败 |
| 配置错误 | `CONFIGURATION_ERROR` | ❌ | 参数错误、配置问题等 |

### 重试策略

- **可重试错误**：系统会自动重试，客户端也可以重试
- **不可重试错误**：需要修正请求参数后再试
- **部分失败**：原文URL失败但AI生成成功，仍返回成功结果

## 监控和调试

### 请求追踪

每个请求都有唯一的requestId，用于端到端追踪：

```json
{
  "requestId": "1693834567890-abc123",
  "timestamp": "2025-09-01T10:30:00.000Z"
}
```

### 处理日志

详细的处理步骤记录在KV存储中，包括：
- 每个步骤的执行时间
- 成功/失败状态
- 详细的错误信息
- 相关的上下文数据

### 性能指标

- **平均响应时间**：通常2-5秒
- **原文URL成功率**：取决于URL质量
- **AI生成成功率**：通常>95%
- **R2存储成功率**：通常>99%

## 最佳实践

### 1. URL质量优化

- ✅ 使用CDN URL而非源服务器URL
- ✅ 确保URL返回正确的Content-Type
- ✅ 避免需要认证的URL
- ✅ 使用压缩过的图片格式（WebP优于JPEG）

### 2. 错误处理

```javascript
async function processImageWithRetry(imageUrl, prompt, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await api.processImage({ imageUrl, prompt });
      
      if (result.success) {
        return result;
      }
      
      // 检查是否可重试
      if (result.details?.retryable === false) {
        throw new Error(`Non-retryable error: ${result.error}`);
      }
      
      // 等待后重试
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      
    } catch (error) {
      if (i === maxRetries - 1) throw error;
    }
  }
}
```

### 3. 性能优化

- ✅ 为不同用途使用不同的articleId组织存储
- ✅ 监控处理时间，必要时调整超时设置
- ✅ 使用合适的图片尺寸，避免过大的图片
- ✅ 缓存成功的结果，避免重复处理相同URL

### 4. 监控告警

建议设置以下告警：
- 原文URL成功率 < 70%
- AI fallback使用率 > 50%
- 平均响应时间 > 10秒
- R2存储失败率 > 5%
- 紧急fallback使用率 > 1%
