# 🎛️ 供应商和模型选择指南

## 🎯 默认行为

当你**不指定**`provider`参数时，系统按以下优先级自动选择：

1. **🥇 Replicate** (默认首选) → 2. **🥈 Fal.ai** (备选) → 3. **🥉 Unsplash** (最后备选)

```bash
# 推荐：让系统自动选择最佳供应商
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "A beautiful landscape"}'
```

## 🔄 改变供应商优先级的方法

### 方法1: 强制指定供应商

```bash
# 强制使用Fal.ai（跳过Replicate）
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A serene mountain lake",
    "provider": "fal"
  }'

# 强制使用Replicate
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "High quality portrait",
    "provider": "replicate"
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

### 方法2: 指定模型，让系统选择供应商

```bash
# 系统会选择支持flux-schnell的最佳供应商（通常是Fal.ai）
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Quick sketch",
    "model": "flux-schnell"
  }'
```

## 🤖 模型详细对比和使用示例

### Flux 1.1 Pro - 最高质量

#### Replicate版本（推荐）
```bash
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A detailed oil painting of a sunset",
    "provider": "replicate",
    "model": "flux-1.1-pro",
    "width": 1024,
    "height": 768
  }'
```
- ✅ **真正的Flux 1.1 Pro模型**
- ✅ **支持自定义尺寸**
- ✅ **最高质量输出**
- ❌ **速度较慢** (10-20秒)
- ❌ **成本较高**

#### Fal.ai版本
```bash
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A detailed oil painting of a sunset",
    "provider": "fal",
    "model": "flux-1.1-pro"
  }'
```
- ⚠️ **实际是Flux.1 Pro（非1.1版本）**
- ❌ **不支持自定义尺寸**
- ✅ **速度较快** (8-15秒)
- ✅ **成本较低**

### Flux Schnell - 最快速度

#### Fal.ai版本（推荐）
```bash
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A simple sketch of a cat",
    "provider": "fal",
    "model": "flux-schnell"
  }'
```
- ✅ **极快速度** (2-4秒)
- ✅ **最低成本**
- ✅ **4步推理优化**
- ❌ **质量一般**
- ❌ **不支持自定义尺寸**

#### Replicate版本
```bash
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
- ✅ **支持自定义尺寸**
- ✅ **稳定性好**
- ❌ **速度较慢** (5-10秒)
- ❌ **成本较高**

### Ideogram - 文字和Logo

#### 文字内容生成
```bash
# Replicate Ideogram Turbo
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Modern logo with text \"ACME CORP\"",
    "provider": "replicate",
    "model": "ideogram-turbo"
  }'

# Fal.ai Ideogram v3
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Vintage poster with text \"WELCOME\"",
    "provider": "fal",
    "model": "ideogram-3.0"
  }'
```

## 🎯 场景化推荐

### 🚀 快速原型开发
```bash
# 最快配置：Fal.ai + Flux Schnell
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "App icon concept",
    "provider": "fal",
    "model": "flux-schnell"
  }'
```
**特点**: 2-4秒生成，成本最低

### 🎨 生产环境
```bash
# 高质量配置：Replicate + Flux 1.1 Pro
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Professional product photo",
    "provider": "replicate",
    "model": "flux-1.1-pro",
    "width": 1024,
    "height": 768
  }'
```
**特点**: 最高质量，支持自定义尺寸

### 💰 成本优化
```bash
# 平衡配置：Fal.ai + Flux 1.1 Pro
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Blog illustration",
    "provider": "fal",
    "model": "flux-1.1-pro"
  }'
```
**特点**: 较好质量，中等速度，较低成本

### 📝 文字内容
```bash
# 文字优化：不指定供应商，让系统选择
curl -X POST https://your-worker.workers.dev/images/generate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Logo design with text \"BRAND NAME\"",
    "model": "ideogram-turbo"
  }'
```
**特点**: 系统自动选择最佳Ideogram实现

## ⚠️ 重要注意事项

### Fal.ai尺寸限制
```bash
# ❌ 错误：Fal.ai不支持自定义尺寸
{
  "provider": "fal",
  "width": 1024,
  "height": 768
}

# ✅ 正确：让系统自动选择尺寸
{
  "provider": "fal",
  "model": "flux-1.1-pro"
}
```

### 供应商选择建议
- **默认推荐**: 不指定`provider`，让系统自动选择
- **质量优先**: 指定`provider: "replicate"`
- **速度优先**: 指定`provider: "fal"`
- **成本优先**: 指定`provider: "fal"` + `model: "flux-schnell"`

## 📊 性能对比表

| 配置 | 速度 | 质量 | 成本 | 尺寸支持 | 推荐场景 |
|------|------|------|------|----------|----------|
| Replicate + flux-1.1-pro | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | ✅ | 生产环境 |
| Fal.ai + flux-1.1-pro | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ❌ | 平衡选择 |
| Fal.ai + flux-schnell | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ | ❌ | 快速原型 |
| 系统自动选择 | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ✅ | **推荐** |

---

**建议**: 大多数情况下，不指定`provider`参数，让系统自动选择最佳配置！
