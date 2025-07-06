# Images Generation Worker Setup Script
# PowerShell script for initial project setup

param(
    [string]$Environment = "development"
)

$ErrorActionPreference = "Stop"

Write-Host "🛠️  Setting up Images Generation Worker" -ForegroundColor Green

# Check prerequisites
Write-Host "📋 Checking prerequisites..." -ForegroundColor Yellow

# Check Node.js
try {
    $nodeVersion = node --version
    Write-Host "✅ Node.js version: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Error "Node.js is not installed. Please install Node.js 18+ first."
    exit 1
}

# Check pnpm
if (!(Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "📦 Installing pnpm..." -ForegroundColor Yellow
    npm install -g pnpm
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to install pnpm."
        exit 1
    }
}

$pnpmVersion = pnpm --version
Write-Host "✅ pnpm version: $pnpmVersion" -ForegroundColor Green

# Install dependencies
Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
pnpm install
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to install dependencies."
    exit 1
}
Write-Host "✅ Dependencies installed" -ForegroundColor Green

# Wrangler authentication
Write-Host "🔐 Checking Wrangler authentication..." -ForegroundColor Yellow
try {
    $whoami = wrangler whoami 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Please authenticate with Cloudflare:" -ForegroundColor Yellow
        wrangler login
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Wrangler authentication failed."
            exit 1
        }
    }
    Write-Host "✅ Authenticated with Cloudflare" -ForegroundColor Green
} catch {
    Write-Error "Failed to check Wrangler authentication: $_"
    exit 1
}

# Create R2 bucket
Write-Host "🪣 Creating R2 bucket..." -ForegroundColor Yellow
$bucketName = "images-gen-storage"
$previewBucketName = "images-gen-storage-preview"

try {
    wrangler r2 bucket create $bucketName 2>$null
    Write-Host "✅ Created R2 bucket: $bucketName" -ForegroundColor Green
} catch {
    Write-Host "⚠️  R2 bucket $bucketName might already exist" -ForegroundColor Yellow
}

try {
    wrangler r2 bucket create $previewBucketName 2>$null
    Write-Host "✅ Created preview R2 bucket: $previewBucketName" -ForegroundColor Green
} catch {
    Write-Host "⚠️  Preview R2 bucket $previewBucketName might already exist" -ForegroundColor Yellow
}

# Create KV namespaces
Write-Host "🗄️  Creating KV namespaces..." -ForegroundColor Yellow

# STATE_KV namespace
try {
    $stateKvOutput = wrangler kv:namespace create "STATE_KV" 2>&1
    $stateKvId = ($stateKvOutput | Select-String -Pattern 'id = "([^"]+)"').Matches[0].Groups[1].Value
    Write-Host "✅ Created STATE_KV namespace: $stateKvId" -ForegroundColor Green
} catch {
    Write-Host "⚠️  STATE_KV namespace might already exist" -ForegroundColor Yellow
}

# STATE_KV preview namespace
try {
    $stateKvPreviewOutput = wrangler kv:namespace create "STATE_KV" --preview 2>&1
    $stateKvPreviewId = ($stateKvPreviewOutput | Select-String -Pattern 'preview_id = "([^"]+)"').Matches[0].Groups[1].Value
    Write-Host "✅ Created STATE_KV preview namespace: $stateKvPreviewId" -ForegroundColor Green
} catch {
    Write-Host "⚠️  STATE_KV preview namespace might already exist" -ForegroundColor Yellow
}

# CONFIG_KV namespace
try {
    $configKvOutput = wrangler kv:namespace create "CONFIG_KV" 2>&1
    $configKvId = ($configKvOutput | Select-String -Pattern 'id = "([^"]+)"').Matches[0].Groups[1].Value
    Write-Host "✅ Created CONFIG_KV namespace: $configKvId" -ForegroundColor Green
} catch {
    Write-Host "⚠️  CONFIG_KV namespace might already exist" -ForegroundColor Yellow
}

# CONFIG_KV preview namespace
try {
    $configKvPreviewOutput = wrangler kv:namespace create "CONFIG_KV" --preview 2>&1
    $configKvPreviewId = ($configKvPreviewOutput | Select-String -Pattern 'preview_id = "([^"]+)"').Matches[0].Groups[1].Value
    Write-Host "✅ Created CONFIG_KV preview namespace: $configKvPreviewId" -ForegroundColor Green
} catch {
    Write-Host "⚠️  CONFIG_KV preview namespace might already exist" -ForegroundColor Yellow
}

# Update wrangler.toml with namespace IDs
Write-Host "📝 Updating wrangler.toml..." -ForegroundColor Yellow
if ($stateKvId -and $configKvId) {
    $wranglerContent = Get-Content "wrangler.toml" -Raw
    
    # Update STATE_KV IDs
    if ($stateKvId) {
        $wranglerContent = $wranglerContent -replace 'id = "your-kv-namespace-id"', "id = `"$stateKvId`""
        if ($stateKvPreviewId) {
            $wranglerContent = $wranglerContent -replace 'preview_id = "your-preview-kv-namespace-id"', "preview_id = `"$stateKvPreviewId`""
        }
    }
    
    # Update CONFIG_KV IDs
    if ($configKvId) {
        $wranglerContent = $wranglerContent -replace 'id = "your-config-kv-namespace-id"', "id = `"$configKvId`""
        if ($configKvPreviewId) {
            $wranglerContent = $wranglerContent -replace 'preview_id = "your-preview-config-kv-namespace-id"', "preview_id = `"$configKvPreviewId`""
        }
    }
    
    Set-Content "wrangler.toml" $wranglerContent
    Write-Host "✅ Updated wrangler.toml with namespace IDs" -ForegroundColor Green
}

# Set up secrets (interactive)
Write-Host "🔑 Setting up API secrets..." -ForegroundColor Yellow
Write-Host "You can set these secrets now or later using 'wrangler secret put <SECRET_NAME>'" -ForegroundColor Cyan

$secrets = @(
    @{Name="REPLICATE_API_TOKEN"; Description="Replicate API token for AI image generation"},
    @{Name="FAL_KEY"; Description="Fal API key for AI image generation"},
    @{Name="UNSPLASH_ACCESS_KEY"; Description="Unsplash access key for stock photos"},
    @{Name="R2_CUSTOM_DOMAIN"; Description="Custom domain for R2 CDN (optional)"}
)

foreach ($secret in $secrets) {
    $setSecret = Read-Host "Set $($secret.Name)? ($($secret.Description)) (y/N)"
    if ($setSecret -eq "y" -or $setSecret -eq "Y") {
        wrangler secret put $secret.Name
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Set secret: $($secret.Name)" -ForegroundColor Green
        } else {
            Write-Warning "Failed to set secret: $($secret.Name)"
        }
    }
}

# Initialize default configuration
Write-Host "⚙️  Initializing default configuration..." -ForegroundColor Yellow
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
    Write-Host "✅ Initialized default configuration" -ForegroundColor Green
} catch {
    Write-Warning "Failed to set default configuration in KV"
}

# Run initial build and test
Write-Host "🔨 Running initial build..." -ForegroundColor Yellow
pnpm run build
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Build failed. Please check for errors."
} else {
    Write-Host "✅ Initial build successful" -ForegroundColor Green
}

# Setup complete
Write-Host "`n🎉 Setup completed successfully!" -ForegroundColor Green
Write-Host "`n📋 Next steps:" -ForegroundColor Cyan
Write-Host "1. Review and update wrangler.toml configuration" -ForegroundColor White
Write-Host "2. Set any missing API secrets: wrangler secret put <SECRET_NAME>" -ForegroundColor White
Write-Host "3. Test locally: pnpm run dev" -ForegroundColor White
Write-Host "4. Deploy to development: pnpm run deploy:development" -ForegroundColor White
Write-Host "5. Check the README.md for detailed usage instructions" -ForegroundColor White

Write-Host "`n🔗 Useful commands:" -ForegroundColor Cyan
Write-Host "pnpm run dev          - Start local development server" -ForegroundColor White
Write-Host "pnpm run deploy       - Deploy to production" -ForegroundColor White
Write-Host "pnpm test             - Run tests" -ForegroundColor White
Write-Host "pnpm run lint         - Run linter" -ForegroundColor White
