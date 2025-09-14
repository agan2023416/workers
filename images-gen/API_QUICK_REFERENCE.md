# 图片生成API - 快速参考

## 🚀 基本信息

**端点**: `POST https://your-worker.workers.dev/images/generate`  
**认证**: `Authorization: Bearer YOUR_API_KEY`

## 📋 请求参数

```json
{
  "imageUrl": "string (可选)",     // 原始图片URL
  "prompt": "string (可选)",       // AI生成提示词  
  "provider": "string (可选)",     // replicate | fal | unsplash
  "model": "string (可选)",        // 见下方模型列表
  "articleId": "string (可选)",    // 文章ID
  "width": "number (可选)",        // 默认1024
  "height": "number (可选)"       // 默认768
}
```

*注意：`imageUrl` 和 `prompt` 至少需要一个*

## 🤖 支持的模型

### Replicate (`provider: "replicate"`)
- `flux-1.1-pro` ⭐ **推荐** - 最高质量
- `flux-1.1-dev` - 开发版本  
- `flux-schnell` - 快速生成
- `ideogram-turbo` - 文字图标
- `ideogram-3.0` - 高质量文字

### Fal.ai (`provider: "fal"`)
- `flux-1.1-pro` - 高质量（实际为Flux.1 Pro）
- `flux-1.1-dev` - 开发版本
- `flux-schnell` ⚡ **最快** - 2-4秒生成
- `ideogram-turbo` - 快速文字
- `ideogram-3.0` - 最新版本

**⚠️ Fal.ai限制**: 不支持自定义尺寸(如1024x768)，只能使用预定义枚举值

## 📝 常用示例

### 1. 原始URL处理
```bash
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"imageUrl": "https://example.com/image.jpg"}'
```

### 2. AI生成（推荐配置）
```bash
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A beautiful sunset over mountains",
    "provider": "fal",
    "model": "flux-1.1-pro"
  }'
```

### 3. 快速生成
```bash
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A cat sitting on a windowsill",
    "provider": "fal", 
    "model": "flux-schnell"
  }'
```

### 4. 自动选择（使用默认优先级）
```bash
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "A futuristic cityscape"}'
```

### 5. 指定供应商和模型
```bash
# 强制使用Fal.ai的flux-schnell（最快）
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A cat in a garden",
    "provider": "fal",
    "model": "flux-schnell"
  }'

# 强制使用Replicate的flux-1.1-pro（最高质量）
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A professional portrait",
    "provider": "replicate",
    "model": "flux-1.1-pro"
  }'

# 使用Ideogram生成文字图片
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Logo with text HELLO WORLD",
    "provider": "replicate",
    "model": "ideogram-turbo"
  }'
```

### 6. 改变供应商优先级的方法

**方法1: 指定首选供应商**
```bash
# 优先使用Fal.ai而不是默认的Replicate
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A beautiful landscape",
    "provider": "fal",
    "model": "flux-1.1-pro"
  }'
```

**方法2: 只指定模型，让系统选择最佳供应商**
```bash
# 系统会选择支持flux-schnell的最佳供应商
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Quick sketch of a dog",
    "model": "flux-schnell"
  }'
```

## 📤 响应格式

```json
{
  "url": "https://your-r2-domain.com/path/image.jpg",
  "provider": "fal",
  "success": true,
  "elapsedMs": 3420,
  "r2Stored": true,
  "source": "ai-generated",
  "actualModel": "fal-ai/flux-pro"
}
```

## ⚡ 性能对比

| 供应商 | 模型 | 速度 | 质量 | 成本 |
|--------|------|------|------|------|
| Fal.ai | flux-schnell | ⚡⚡⚡ | ⭐⭐ | 💰 |
| Fal.ai | flux-1.1-pro | ⚡⚡ | ⭐⭐⭐ | 💰💰 |
| Replicate | flux-1.1-pro | ⚡ | ⭐⭐⭐⭐ | 💰💰💰 |

## 🎯 使用建议

### 默认优先级（不指定provider时）
1. **🥇 Replicate** (默认首选) - 稳定性最高
2. **🥈 Fal.ai** (备选) - 速度快但有尺寸限制
3. **🥉 Unsplash** (最后备选) - 免费库存图片

### 场景推荐
- **快速原型**: `fal` + `flux-schnell`
- **生产环境**: `replicate` + `flux-1.1-pro` (默认)
- **文字图片**: 任意供应商 + `ideogram-turbo`
- **成本优先**: `fal` + `flux-schnell`
- **质量优先**: `replicate` + `flux-1.1-pro`

## 🔧 环境变量

```bash
# 必需
REPLICATE_API_TOKEN=your_token
FAL_KEY=your_key  
API_KEY=your_api_key

# 可选
UNSPLASH_ACCESS_KEY=your_key
R2_CUSTOM_DOMAIN=your_domain
```

## 🔍 调试

- **测试页面**: `https://your-worker.workers.dev/test`
- **健康检查**: `GET https://your-worker.workers.dev/health`
- **日志**: 查看Cloudflare Workers日志

## ❌ 常见错误

| 错误 | 原因 | 解决 |
|------|------|------|
| `401 Unauthorized` | API密钥错误 | 检查Authorization头 |
| `400 Missing parameters` | 缺少必需参数 | 提供imageUrl或prompt |
| `emergency-fallback` | 所有供应商失败 | 检查API密钥和网络 |

---

**完整文档**: 查看 `API_DOCUMENTATION.md`  
**版本**: 2.0 | **更新**: 2025-09-14
