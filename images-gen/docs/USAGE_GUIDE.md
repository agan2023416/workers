# 🎨 AI Image Generation Worker - 详细使用指南

## 📋 **概述**

这是一个基于 Cloudflare Workers 的 **私有** AI 图片生成服务，支持多个 AI 提供商，具有智能优先级系统和 R2 存储集成。

**🌟 核心特性**:
- **🔐 私有访问**: 需要 API 密钥认证，确保安全
- **Replicate 最高优先级**: 90秒超时，确保最佳质量
- **多提供商支持**: Replicate → Fal AI → Unsplash 智能降级
- **R2 存储集成**: 自动存储图片，客户端直接访问
- **全球 CDN**: Cloudflare 网络加速访问

---

## 🔐 **认证要求**

**⚠️ 重要**: 除了 `/health` 端点外，所有 API 调用都需要 API 密钥认证。

### **认证方式**
在请求头中添加 `Authorization` 头：
```
Authorization: Bearer YOUR_API_KEY
```

### **获取 API 密钥**
API 密钥由服务管理员通过以下方式配置：
```bash
wrangler secret put API_KEY --env production
```

---

## 🚀 **API 端点**

### **基础 URL**
```
https://images-gen-worker-prod.agan2023416.workers.dev
```

### **主要端点**
- `GET /health` - 健康检查（**无需认证**）
- `POST /images/generate` - 图片生成（**需要认证**）
- `GET /images/r2` - R2 存储图片访问（**需要认证**）
- `POST /test-r2` - R2 存储测试（**需要认证**）

---

## 🎯 **图片生成 API**

### **端点**: `POST /images/generate`

### **请求格式**
```json
{
  "prompt": "图片描述文本",
  "provider": "提供商名称（可选）",
  "articleId": "文章ID（可选，启用R2存储）"
}
```

### **参数说明**

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `prompt` | string | ✅ | 图片描述文本，支持英文 |
| `provider` | string | ❌ | 指定提供商：`replicate`、`fal`、`unsplash` |
| `articleId` | string | ❌ | 文章ID，提供时自动存储到R2 |

### **响应格式**
```json
{
  "url": "图片访问URL",
  "provider": "实际使用的提供商",
  "elapsedMs": 生成耗时毫秒,
  "success": true/false,
  "error": "错误信息（如有）",
  "r2Stored": true/false,
  "r2Error": "R2错误信息（如有）"
}
```

---

## 📝 **使用示例**

### **1. 自动模式（推荐）- Replicate 最高优先级**

**请求**:
```bash
curl -X POST https://images-gen-worker-prod.agan2023416.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "a beautiful sunset over mountains with golden light"
  }'
```

**响应**:
```json
{
  "url": "https://replicate.delivery/xezq/abc123.webp",
  "provider": "replicate",
  "elapsedMs": 4562,
  "success": true
}
```

**特点**:
- 🥇 **Replicate 优先**: 90秒超时，最高质量
- 🥈 **Fal AI 备用**: 30秒超时，快速生成
- 🥉 **Unsplash 保底**: 库存图片，确保成功

### **2. 指定 Replicate 提供商**

**请求**:
```bash
curl -X POST https://images-gen-worker-prod.agan2023416.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "astronaut riding a rocket like a horse",
    "provider": "replicate"
  }'
```

**响应**:
```json
{
  "url": "https://replicate.delivery/xezq/def456.webp",
  "provider": "replicate",
  "elapsedMs": 6234,
  "success": true
}
```

### **3. 指定 Fal AI 提供商（快速生成）**

**请求**:
```bash
curl -X POST https://images-gen-worker-prod.agan2023416.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "cyberpunk city at night with neon lights",
    "provider": "fal"
  }'
```

**响应**:
```json
{
  "url": "https://v3.fal.media/files/penguin/ghi789.png",
  "provider": "fal",
  "elapsedMs": 1240,
  "success": true
}
```

### **4. 带 R2 存储的图片生成**

**请求**:
```bash
curl -X POST https://images-gen-worker-prod.agan2023416.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "beautiful landscape with mountains and lake",
    "articleId": "blog-post-123"
  }'
```

**响应**:
```json
{
  "url": "https://images-gen-worker-prod.agan2023416.workers.dev/images/r2?key=articles%2Fblog-post-123%2Fimages%2F2025-07-06T09-15-30-456Z.jpg",
  "provider": "replicate",
  "elapsedMs": 5678,
  "success": true,
  "r2Stored": true
}
```

**特点**:
- 🗄️ **自动存储**: 图片存储到 Cloudflare R2
- 🌐 **CDN 加速**: 全球访问加速
- 🔗 **直接访问**: 返回可直接使用的 R2 URL
- 💾 **元数据**: KV 存储图片信息

### **5. Unsplash 库存图片**

**请求**:
```bash
curl -X POST https://images-gen-worker-prod.agan2023416.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "sunset beach ocean waves",
    "provider": "unsplash"
  }'
```

**响应**:
```json
{
  "url": "https://images.unsplash.com/photo-1234567890?w=1024&h=768&fit=crop",
  "provider": "unsplash",
  "elapsedMs": 456,
  "success": true
}
```

---

## 🏆 **优先级系统详解**

### **自动模式优先级**
```
1. Replicate AI (90秒超时) - 🥇 最高优先级
   ↓ 失败/超时
2. Fal AI (30秒超时) - 🥈 次要优先级  
   ↓ 失败/超时
3. Unsplash (10秒超时) - 🥉 保底选择
   ↓ 失败
4. 紧急回退 - 静态图片URL
```

### **超时配置**
- **Replicate**: 90秒（确保复杂模型有足够时间）
- **Fal AI**: 30秒（快速生成）
- **Unsplash**: 10秒（快速搜索）

### **质量对比**
| 提供商 | 质量 | 速度 | 成本 | 适用场景 |
|--------|------|------|------|----------|
| Replicate | 🌟🌟🌟🌟🌟 | 中等 | 高 | 高质量创意图片 |
| Fal AI | 🌟🌟🌟🌟 | 快 | 中 | 快速AI生成 |
| Unsplash | 🌟🌟🌟 | 很快 | 低 | 库存图片 |

---

## 🗄️ **R2 存储系统**

### **存储触发条件**
- 请求中包含 `articleId` 参数
- 图片生成成功

### **存储路径结构**
```
articles/{articleId}/images/{timestamp}.jpg
```

### **访问 R2 图片**
```
GET /images/r2?key={encoded_key}
```

### **元数据存储**
存储在 KV 中，键格式：`image:{articleId}:{timestamp}`

**元数据内容**:
```json
{
  "key": "R2存储键",
  "originalUrl": "原始图片URL", 
  "storedAt": "存储时间",
  "contentType": "image/jpeg",
  "size": 文件大小字节数
}
```

---

## 🔧 **JavaScript 客户端示例**

### **基础使用**
```javascript
async function generateImage(prompt, apiKey, options = {}) {
  const response = await fetch('https://images-gen-worker-prod.agan2023416.workers.dev/images/generate', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      ...options
    })
  });

  return await response.json();
}

// 使用示例
const apiKey = 'your-api-key-here';
const result = await generateImage('beautiful sunset over mountains', apiKey);
console.log('Generated image:', result.url);
```

### **带错误处理**
```javascript
async function generateImageWithErrorHandling(prompt, apiKey, options = {}) {
  try {
    const response = await fetch('https://images-gen-worker-prod.agan2023416.workers.dev/images/generate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        ...options
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Generation failed');
    }

    return result;
  } catch (error) {
    console.error('Image generation error:', error);
    throw error;
  }
}
```

### **React 组件示例**
```jsx
import React, { useState } from 'react';

function ImageGenerator() {
  const [prompt, setPrompt] = useState('');
  const [apiKey, setApiKey] = useState(''); // 添加 API 密钥状态
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const generateImage = async () => {
    if (!apiKey) {
      alert('请输入 API 密钥');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('https://images-gen-worker-prod.agan2023416.workers.dev/images/generate', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          articleId: 'react-demo-' + Date.now()
        })
      });

      const data = await response.json();
      setResult(data);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <input
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder="输入 API 密钥..."
        style={{marginBottom: '10px', width: '100%'}}
      />
      <input
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="描述你想要的图片..."
        style={{marginBottom: '10px', width: '100%'}}
      />
      <button onClick={generateImage} disabled={loading || !apiKey}>
        {loading ? '生成中...' : '生成图片'}
      </button>

      {result && (
        <div>
          <p>提供商: {result.provider}</p>
          <p>耗时: {result.elapsedMs}ms</p>
          <img src={result.url} alt="Generated" style={{maxWidth: '100%'}} />
        </div>
      )}
    </div>
  );
}
```

---

## ⚡ **性能优化建议**

### **1. 提示词优化**
- 使用英文描述（AI模型训练语言）
- 具体而详细的描述
- 避免过于复杂的场景

### **2. 提供商选择**
- **高质量需求**: 使用自动模式或指定 `replicate`
- **快速生成**: 指定 `fal`
- **库存图片**: 指定 `unsplash`

### **3. R2 存储优化**
- 仅在需要长期存储时使用 `articleId`
- 利用 CDN 缓存减少重复请求

---

## 🔍 **故障排除**

### **常见错误**

#### **1. 认证错误**
```json
{
  "error": "Unauthorized - API key required",
  "timestamp": "2025-07-06T09:00:00.000Z"
}
```
**解决方案**:
- 确保在请求头中包含 `Authorization: Bearer YOUR_API_KEY`
- 检查 API 密钥是否正确
- 联系管理员获取有效的 API 密钥

#### **2. 超时错误**
```json
{
  "success": false,
  "error": "Replicate timeout after 90s",
  "provider": "replicate-fallback"
}
```
**解决方案**: 系统会自动降级到 Fal AI

#### **2. 提供商 API 密钥错误**
```json
{
  "success": false,
  "error": "Fal AI API error: 401",
  "provider": "fal-fallback"
}
```
**解决方案**: 系统会自动降级到下一个提供商

#### **3. R2 存储失败**
```json
{
  "success": true,
  "r2Stored": false,
  "r2Error": "R2 storage failed"
}
```
**解决方案**: 图片生成成功，但未存储到 R2

### **健康检查（无需认证）**
```bash
curl https://images-gen-worker-prod.agan2023416.workers.dev/health
```

**正常响应**:
```json
{
  "status": "healthy",
  "timestamp": "2025-07-06T09:00:00.000Z",
  "version": "1.0.0",
  "secrets": {
    "replicate": true,
    "fal": true,
    "unsplash": true,
    "api": true
  }
}
```

---

## 🎯 **最佳实践**

### **1. Replicate 最大化使用**
- 默认使用自动模式（无 `provider` 参数）
- Replicate 有 90秒充足时间生成高质量图片
- 只有在 Replicate 失败时才会降级

### **2. 提示词建议**
```javascript
// ✅ 好的提示词
"a photorealistic portrait of a cat wearing a red hat, studio lighting, high detail"

// ❌ 避免的提示词  
"cat hat red"
```

### **3. 错误处理**
```javascript
// 始终检查 success 字段
if (result.success) {
  // 使用 result.url
} else {
  // 处理错误：result.error
}
```

### **4. R2 存储使用**
```javascript
// 需要长期存储时使用
{
  "prompt": "...",
  "articleId": "blog-post-123"  // 触发 R2 存储
}
```

---

## 📊 **监控和分析**

### **响应时间监控**
- **Replicate**: 通常 4-8 秒
- **Fal AI**: 通常 1-3 秒  
- **Unsplash**: 通常 <1 秒

### **成功率监控**
- 检查 `success` 字段
- 监控 `provider` 字段了解实际使用的提供商
- 跟踪 `elapsedMs` 了解性能

---

## 🌟 **总结**

这个 AI 图片生成 Worker 提供了：

✅ **Replicate 最高优先级** - 90秒超时确保最佳质量
✅ **智能降级系统** - 自动切换到可用提供商  
✅ **R2 存储集成** - 自动存储和 CDN 访问
✅ **全球加速** - Cloudflare 网络优化
✅ **简单易用** - RESTful API 设计
✅ **生产就绪** - 完整错误处理和监控

**🎯 推荐使用自动模式以获得最佳的 Replicate 优先级体验！**
