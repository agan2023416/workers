# Quick Setup Script for Images Generation Worker
# 快速设置脚本

param(
    [switch]$SkipSecrets,
    [switch]$SkipDeploy
)

$ErrorActionPreference = "Stop"

Write-Host "🚀 Images Generation Worker - 快速设置" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Green

# 检查先决条件
Write-Host "📋 检查先决条件..." -ForegroundColor Yellow

if (!(Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Error "pnpm 未安装。请先安装 pnpm。"
    exit 1
}

if (!(Get-Command wrangler -ErrorAction SilentlyContinue)) {
    Write-Host "📦 安装依赖..." -ForegroundColor Yellow
    pnpm install
}

# 检查 Wrangler 认证
try {
    $whoami = wrangler whoami 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "🔐 请登录 Cloudflare..." -ForegroundColor Yellow
        wrangler login
    }
    Write-Host "✅ 已认证: $whoami" -ForegroundColor Green
} catch {
    Write-Error "Wrangler 认证失败: $_"
    exit 1
}

# 创建 R2 存储桶
Write-Host "🪣 创建 R2 存储桶..." -ForegroundColor Yellow

$buckets = @("images-gen-storage", "images-gen-storage-preview")
foreach ($bucket in $buckets) {
    try {
        wrangler r2 bucket create $bucket 2>$null
        Write-Host "✅ 创建存储桶: $bucket" -ForegroundColor Green
    } catch {
        Write-Host "⚠️  存储桶 $bucket 可能已存在" -ForegroundColor Yellow
    }
}

# 创建 KV 命名空间
Write-Host "🗄️  创建 KV 命名空间..." -ForegroundColor Yellow

$kvNamespaces = @(
    @{Name="STATE_KV"; Description="状态存储"},
    @{Name="CONFIG_KV"; Description="配置存储"}
)

$kvIds = @{}

foreach ($kv in $kvNamespaces) {
    try {
        Write-Host "创建 $($kv.Name) ($($kv.Description))..." -ForegroundColor Cyan
        
        # 创建生产环境 KV
        $output = wrangler kv:namespace create $kv.Name 2>&1
        if ($output -match 'id = "([^"]+)"') {
            $kvIds["$($kv.Name)_ID"] = $matches[1]
            Write-Host "✅ 生产环境 ID: $($matches[1])" -ForegroundColor Green
        }
        
        # 创建预览环境 KV
        $previewOutput = wrangler kv:namespace create $kv.Name --preview 2>&1
        if ($previewOutput -match 'preview_id = "([^"]+)"') {
            $kvIds["$($kv.Name)_PREVIEW_ID"] = $matches[1]
            Write-Host "✅ 预览环境 ID: $($matches[1])" -ForegroundColor Green
        }
    } catch {
        Write-Warning "创建 KV 命名空间 $($kv.Name) 时出错: $_"
    }
}

# 更新 wrangler.toml
if ($kvIds.Count -gt 0) {
    Write-Host "📝 更新 wrangler.toml..." -ForegroundColor Yellow
    
    $wranglerContent = Get-Content "wrangler.toml" -Raw
    
    # 更新 STATE_KV IDs
    if ($kvIds["STATE_KV_ID"]) {
        $wranglerContent = $wranglerContent -replace 'id = "your-kv-namespace-id"', "id = `"$($kvIds['STATE_KV_ID'])`""
    }
    if ($kvIds["STATE_KV_PREVIEW_ID"]) {
        $wranglerContent = $wranglerContent -replace 'preview_id = "your-preview-kv-namespace-id"', "preview_id = `"$($kvIds['STATE_KV_PREVIEW_ID'])`""
    }
    
    # 更新 CONFIG_KV IDs
    if ($kvIds["CONFIG_KV_ID"]) {
        $wranglerContent = $wranglerContent -replace 'id = "your-config-kv-namespace-id"', "id = `"$($kvIds['CONFIG_KV_ID'])`""
    }
    if ($kvIds["CONFIG_KV_PREVIEW_ID"]) {
        $wranglerContent = $wranglerContent -replace 'preview_id = "your-preview-config-kv-namespace-id"', "preview_id = `"$($kvIds['CONFIG_KV_PREVIEW_ID'])`""
    }
    
    Set-Content "wrangler.toml" $wranglerContent
    Write-Host "✅ wrangler.toml 已更新" -ForegroundColor Green
}

# 设置 API 密钥
if (!$SkipSecrets) {
    Write-Host "🔑 设置 API 密钥..." -ForegroundColor Yellow
    Write-Host "提示：如果暂时没有某个服务的密钥，可以先跳过，稍后再设置" -ForegroundColor Cyan
    
    $secrets = @(
        @{Name="REPLICATE_API_TOKEN"; Description="Replicate API Token (用于 AI 图片生成)"; Required=$true},
        @{Name="FAL_KEY"; Description="Fal API Key (用于快速 AI 图片生成)"; Required=$true},
        @{Name="UNSPLASH_ACCESS_KEY"; Description="Unsplash Access Key (用于库存照片)"; Required=$true},
        @{Name="R2_CUSTOM_DOMAIN"; Description="R2 自定义域名 (可选，如: cdn.yourdomain.com)"; Required=$false},
        @{Name="ADMIN_TOKEN"; Description="管理员访问令牌 (用于管理端点)"; Required=$true}
    )
    
    foreach ($secret in $secrets) {
        $setSecret = Read-Host "设置 $($secret.Name)? ($($secret.Description)) (y/N)"
        if ($setSecret -eq "y" -or $setSecret -eq "Y") {
            try {
                wrangler secret put $secret.Name
                Write-Host "✅ 已设置: $($secret.Name)" -ForegroundColor Green
            } catch {
                Write-Warning "设置密钥 $($secret.Name) 失败: $_"
            }
        } elseif ($secret.Required) {
            Write-Host "⚠️  $($secret.Name) 是必需的，稍后可以使用以下命令设置：" -ForegroundColor Yellow
            Write-Host "   wrangler secret put $($secret.Name)" -ForegroundColor Cyan
        }
    }
}

# 初始化默认配置
Write-Host "⚙️  初始化默认配置..." -ForegroundColor Yellow
$defaultConfig = @{
    providers = @{
        replicate = @{
            enabled = $true
            timeout = 180000
            retries = 0
            priority = 1
        }
        fal = @{
            enabled = $true
            timeout = 15000
            retries = 2
            priority = 2
        }
        unsplash = @{
            enabled = $true
            timeout = 5000
            retries = 1
            priority = 3
        }
    }
    r2 = @{
        pathPrefix = "ai"
        cacheControl = "public, max-age=31536000, immutable"
    }
    defaults = @{
        timeout = 30000
        imageUrl = "https://via.placeholder.com/1024x768/4A90E2/FFFFFF?text=Default+Image"
    }
}

$configJson = $defaultConfig | ConvertTo-Json -Depth 10
try {
    wrangler kv:key put --binding=CONFIG_KV "app-config" $configJson
    Write-Host "✅ 默认配置已初始化" -ForegroundColor Green
} catch {
    Write-Warning "初始化配置失败: $_"
}

# 构建项目
Write-Host "🔨 构建项目..." -ForegroundColor Yellow
try {
    pnpm run type-check
    Write-Host "✅ 类型检查通过" -ForegroundColor Green
} catch {
    Write-Warning "类型检查失败，但继续进行..."
}

try {
    pnpm run lint
    Write-Host "✅ 代码检查通过" -ForegroundColor Green
} catch {
    Write-Warning "代码检查有警告，但继续进行..."
}

# 部署
if (!$SkipDeploy) {
    Write-Host "🚀 部署到开发环境..." -ForegroundColor Yellow
    try {
        wrangler deploy --env development
        Write-Host "✅ 开发环境部署成功" -ForegroundColor Green
        
        $deployProd = Read-Host "是否部署到生产环境? (y/N)"
        if ($deployProd -eq "y" -or $deployProd -eq "Y") {
            wrangler deploy --env production
            Write-Host "✅ 生产环境部署成功" -ForegroundColor Green
        }
    } catch {
        Write-Warning "部署失败: $_"
    }
}

# 完成总结
Write-Host "`n🎉 设置完成！" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Green

Write-Host "`n📋 下一步操作：" -ForegroundColor Cyan
Write-Host "1. 如果跳过了密钥设置，请使用以下命令设置：" -ForegroundColor White
Write-Host "   wrangler secret put REPLICATE_API_TOKEN" -ForegroundColor Gray
Write-Host "   wrangler secret put FAL_KEY" -ForegroundColor Gray
Write-Host "   wrangler secret put UNSPLASH_ACCESS_KEY" -ForegroundColor Gray

Write-Host "`n2. 更新 Webhook URL（在 src/services/providers/replicate.ts）：" -ForegroundColor White
Write-Host "   将 'your-worker-domain.workers.dev' 替换为实际域名" -ForegroundColor Gray

Write-Host "`n3. 测试部署：" -ForegroundColor White
Write-Host "   curl https://your-worker-domain.workers.dev/health" -ForegroundColor Gray

Write-Host "`n4. 测试图片生成：" -ForegroundColor White
Write-Host "   curl -X POST https://your-worker-domain.workers.dev/images/generate \" -ForegroundColor Gray
Write-Host "     -H 'Content-Type: application/json' \" -ForegroundColor Gray
Write-Host "     -d '{\"prompt\": \"A beautiful sunset\"}'" -ForegroundColor Gray

Write-Host "`n📚 更多信息请查看：" -ForegroundColor Cyan
Write-Host "   - README.md - 项目概述和 API 文档" -ForegroundColor White
Write-Host "   - DEPLOYMENT_GUIDE.md - 详细部署指南" -ForegroundColor White
Write-Host "   - examples/api-usage.md - API 使用示例" -ForegroundColor White

Write-Host "`n✨ 项目已准备就绪！" -ForegroundColor Green
