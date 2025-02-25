# Replicate to R2 Worker

A Cloudflare Worker that generates images using Replicate's API and stores them in Cloudflare R2. Built using the official Replicate client library.

## Features

- Worker API token authentication for MCP access
- Immediate unique URL generation for image placeholders
- Official Replicate SDK integration with type safety
- Standard model/version identification format
- Asynchronous image generation and R2 storage
- Comprehensive webhook support
- CORS support for browser access

## Documentation

For detailed API documentation including request/response formats and examples, see [API Documentation](API.md).

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure R2:
   - In the Cloudflare dashboard, go to R2 > Buckets
   - Create two buckets:
     - Production bucket (e.g., `blog-gnc`)
     - Development bucket (e.g., `blog-gnc-dev`)
   - For each bucket:
     - Click on "Settings"
     - Under "Public Access", create a public bucket URL
     - Copy the public bucket URL base (looks like `https://pub-{hash}.r2.dev`)

3. Configure Production Environment:
   Update `wrangler.toml`:
   ```toml
   [[r2_buckets]]
   binding = "BUCKET"
   bucket_name = "blog-gnc"           # Production bucket
   preview_bucket_name = "blog-gnc-dev" # Development bucket

   [vars]
   # Production bucket URL
   BUCKET_URL = "https://pub-{hash}.r2.dev/blog-gnc"
   ```

4. Configure Development Environment:
   Create a `.dev.vars` file in the project root:
   ```
   WORKER_API_TOKEN=your_dev_token_here
   REPLICATE_API_TOKEN=your_replicate_dev_token_here
   REPLICATE_WEBHOOK_SECRET=your_webhook_secret_here
   BUCKET_URL=https://pub-{hash}.r2.dev/blog-gnc-dev
   ```
   Note: 
   - `.dev.vars` is automatically ignored by git for security
   - Variables in `.dev.vars` take precedence during local development

5. For production deployment, set up required secrets:
```bash
wrangler secret put WORKER_API_TOKEN
wrangler secret put REPLICATE_API_TOKEN
wrangler secret put REPLICATE_WEBHOOK_SECRET
```

## Development

The worker supports two development modes:

### Remote Development (Recommended)
Uses the actual R2 bucket for storage, best for testing with real data:
```bash
npm run dev
```

This will:
- Use your remote R2 bucket for storage
- Connect to real Replicate API
- Enable testing with actual webhooks
- Store images in the development R2 bucket

### Local Development
Uses local storage simulation, good for offline development:
```bash
npm run dev:local
```

This will:
- Simulate R2 storage locally (stored in `.wrangler/state/v3/r2/`)
- Connect to real Replicate API
- May have limitations with webhook testing
- No actual R2 storage costs

For production deployment:
```bash
npm run deploy
```

Type checking:
```bash
npm run type-check
```

## Environment Variables

### Development (.dev.vars)
All development environment variables should be defined in `.dev.vars`:
```
WORKER_API_TOKEN=dev_token
REPLICATE_API_TOKEN=dev_replicate_token
REPLICATE_WEBHOOK_SECRET=dev_webhook_secret
BUCKET_URL=https://pub-{hash}.r2.dev/blog-gnc-dev
```

### Production (wrangler.toml + secrets)
Production uses a combination of wrangler.toml variables and secrets:
```toml
# wrangler.toml
[vars]
BUCKET_URL = "https://pub-{hash}.r2.dev/blog-gnc"
```
```bash
# Secrets (set via wrangler secret put)
WORKER_API_TOKEN
REPLICATE_API_TOKEN
REPLICATE_WEBHOOK_SECRET
```

## Local Storage
When using `npm run dev:local`, the worker simulates R2 storage using local SQLite files:
- Located in `.wrangler/state/v3/r2/`
- Not meant for production use
- Useful for offline development
- Data persists between development sessions

## R2 URL Structure

The R2 URLs are constructed as follows:
```
https://pub-{hash}.r2.dev/{bucket-name}/{file-name}
```
Where:
- `{hash}` is your R2 public URL identifier
- `{bucket-name}` is either your production or development bucket name
- `{file-name}` is the generated image filename

For example:
- Production: `https://pub-abc123.r2.dev/blog-gnc/image.png`
- Development: `https://pub-abc123.r2.dev/blog-gnc-dev/image.png`

## Technical Implementation

- Uses the official Replicate SDK with built-in TypeScript support
- Standard model identification (e.g., "black-forest-labs/flux-schnell")
- Optional version specification for model versioning
- Implements proper prediction lifecycle management
- Supports webhook integration for status updates
- Handles asynchronous image storage in R2
- Secure webhook signature verification

## Error Handling

The worker includes comprehensive error handling for:
- Invalid authentication
- Missing required fields
- Replicate API errors
- Image download failures
- R2 storage issues
- Webhook delivery failures
- Invalid webhook signatures

## Example Usage

Basic request:
```json
{
  "prompt": "Your image description",
  "model": "black-forest-labs/flux-schnell"
}
```

With specific version:
```json
{
  "prompt": "Your image description",
  "model": "black-forest-labs/flux-schnell",
  "version": "39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b"
}
```

See [API Documentation](API.md) for more detailed examples and webhook integration.
