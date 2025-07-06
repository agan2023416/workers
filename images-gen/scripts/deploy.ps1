# Images Generation Worker Deployment Script
# PowerShell script for Windows deployment

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("development", "staging", "production")]
    [string]$Environment,
    
    [switch]$SkipTests,
    [switch]$SkipValidation,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

Write-Host "🚀 Deploying Images Generation Worker to $Environment" -ForegroundColor Green

# Check prerequisites
Write-Host "📋 Checking prerequisites..." -ForegroundColor Yellow

# Check if pnpm is installed
if (!(Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Error "pnpm is not installed. Please install pnpm first."
    exit 1
}

# Check if wrangler is available
if (!(Get-Command wrangler -ErrorAction SilentlyContinue)) {
    Write-Error "Wrangler CLI is not available. Please run 'pnpm install' first."
    exit 1
}

# Verify wrangler authentication
try {
    $whoami = wrangler whoami 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Wrangler authentication failed. Please run 'wrangler login' first."
        exit 1
    }
    Write-Host "✅ Authenticated as: $whoami" -ForegroundColor Green
} catch {
    Write-Error "Failed to check wrangler authentication: $_"
    exit 1
}

# Run tests unless skipped
if (!$SkipTests) {
    Write-Host "🧪 Running tests..." -ForegroundColor Yellow
    pnpm test
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Tests failed. Use -SkipTests to bypass."
        exit 1
    }
    Write-Host "✅ All tests passed" -ForegroundColor Green
}

# Type checking
Write-Host "🔍 Running type check..." -ForegroundColor Yellow
pnpm run type-check
if ($LASTEXITCODE -ne 0) {
    Write-Error "Type checking failed."
    exit 1
}
Write-Host "✅ Type checking passed" -ForegroundColor Green

# Linting
Write-Host "🔧 Running linter..." -ForegroundColor Yellow
pnpm run lint
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Linting issues found. Consider fixing them."
    if (!$Force) {
        $continue = Read-Host "Continue anyway? (y/N)"
        if ($continue -ne "y" -and $continue -ne "Y") {
            exit 1
        }
    }
}

# Environment-specific validations
if (!$SkipValidation) {
    Write-Host "🔐 Validating environment configuration..." -ForegroundColor Yellow
    
    # Check required secrets for production
    if ($Environment -eq "production") {
        $requiredSecrets = @("REPLICATE_API_TOKEN", "FAL_KEY", "UNSPLASH_ACCESS_KEY")
        foreach ($secret in $requiredSecrets) {
            try {
                $secretList = wrangler secret list --env $Environment 2>&1
                if ($secretList -notmatch $secret) {
                    Write-Warning "Secret $secret is not set for $Environment environment"
                    if (!$Force) {
                        $continue = Read-Host "Continue without $secret? (y/N)"
                        if ($continue -ne "y" -and $continue -ne "Y") {
                            Write-Host "Set the secret with: wrangler secret put $secret --env $Environment"
                            exit 1
                        }
                    }
                }
            } catch {
                Write-Warning "Could not verify secret $secret"
            }
        }
    }
    
    Write-Host "✅ Environment validation completed" -ForegroundColor Green
}

# Build the project
Write-Host "🔨 Building project..." -ForegroundColor Yellow
pnpm run build
if ($LASTEXITCODE -ne 0) {
    Write-Error "Build failed."
    exit 1
}
Write-Host "✅ Build completed" -ForegroundColor Green

# Deploy based on environment
Write-Host "🚀 Deploying to $Environment..." -ForegroundColor Yellow

switch ($Environment) {
    "development" {
        wrangler deploy --env development
    }
    "staging" {
        wrangler deploy --env staging
    }
    "production" {
        # Production deployment with confirmation
        if (!$Force) {
            Write-Host "⚠️  You are about to deploy to PRODUCTION!" -ForegroundColor Red
            $confirm = Read-Host "Are you sure? Type 'DEPLOY' to confirm"
            if ($confirm -ne "DEPLOY") {
                Write-Host "Deployment cancelled." -ForegroundColor Yellow
                exit 0
            }
        }
        wrangler deploy --env production
    }
}

if ($LASTEXITCODE -ne 0) {
    Write-Error "Deployment failed."
    exit 1
}

Write-Host "✅ Deployment to $Environment completed successfully!" -ForegroundColor Green

# Post-deployment validation
Write-Host "🔍 Running post-deployment validation..." -ForegroundColor Yellow

# Get the deployed URL
$workerName = switch ($Environment) {
    "development" { "images-gen-worker-dev" }
    "staging" { "images-gen-worker-staging" }
    "production" { "images-gen-worker-prod" }
}

$workerUrl = "https://$workerName.your-subdomain.workers.dev"

# Health check
try {
    Write-Host "Checking health endpoint..." -ForegroundColor Yellow
    $healthResponse = Invoke-RestMethod -Uri "$workerUrl/health" -Method Get -TimeoutSec 30
    if ($healthResponse.status -eq "healthy") {
        Write-Host "✅ Health check passed" -ForegroundColor Green
    } else {
        Write-Warning "Health check returned: $($healthResponse.status)"
    }
} catch {
    Write-Warning "Health check failed: $_"
}

# Display deployment summary
Write-Host "`n📊 Deployment Summary:" -ForegroundColor Cyan
Write-Host "Environment: $Environment" -ForegroundColor White
Write-Host "Worker URL: $workerUrl" -ForegroundColor White
Write-Host "Admin URL: $workerUrl/admin/status" -ForegroundColor White
Write-Host "Deployed at: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor White

Write-Host "`n🎉 Deployment completed successfully!" -ForegroundColor Green
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Test the API endpoints" -ForegroundColor White
Write-Host "2. Monitor the logs in Cloudflare dashboard" -ForegroundColor White
Write-Host "3. Set up alerts and monitoring" -ForegroundColor White
