# Replicate to R2 Worker

A Cloudflare Worker that generates images using Replicate's API and stores them in Cloudflare R2. Built using the official Replicate client library.

## Features

- Worker API token authentication for MCP access
- Immediate unique URL generation for image placeholders
- Official Replicate SDK integration with type safety
- Standard model identification format
- Asynchronous image generation and R2 storage
- Comprehensive webhook support
- CORS support for browser access

## Documentation

For detailed API documentation including request/response formats and examples, see [API Documentation](API.md).

## MCP Integration

### Overview

This worker is designed to work seamlessly with MCP servers, particularly with the [generate-image](../mcps/generate-image) MCP server implementation. The integration provides a complete solution for AI image generation through MCP.

### Flow Diagram

```mermaid
sequenceDiagram
    participant Client
    participant MCP Server
    participant Worker
    participant Replicate
    participant R2 Storage

    Client->>MCP Server: Generate image request
    MCP Server->>Worker: POST /generate with prompt
    Worker->>Replicate: Submit generation job
    Worker-->>MCP Server: Return image name & prediction ID
    Replicate-->>Worker: Webhook: Generation complete
    Worker->>Replicate: Download image
    Worker->>R2 Storage: Store image
    Note over Worker,R2 Storage: Current Implementation
    
    %% Alternative Webhook Flow
    Note over MCP Server,Worker: Alternative Implementation
    Worker-->>MCP Server: Webhook: Update with final URL
```

### MCP Server Implementation

We provide a reference implementation of an MCP server in the [generate-image](../mcps/generate-image) directory. This server:

1. Provides a simple interface for image generation
2. Handles authentication and API communication
3. Manages asynchronous generation flow
4. Supports real-time status updates

To use this implementation:

1. Navigate to the [generate-image](../mcps/generate-image) directory
2. Follow the setup instructions in its README
3. Configure your MCP settings as described in the implementation

### MCP Server Configuration

Add the following configuration to your MCP settings file (`cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "generate-image": {
      "command": "node",
      "args": [
        "PATH_TO_YOUR_GENERATE_IMAGE_SERVER"
      ],
      "env": {
        "WORKER_API_TOKEN": "YOUR_WORKER_API_TOKEN",
        "CLOUDFLARE_WORKERS_URL": "YOUR_WORKER_URL"
      },
      "disabled": false,
      "alwaysAllow": []
    }
  }
}
```

Make sure to replace:
- `PATH_TO_YOUR_GENERATE_IMAGE_SERVER`: Path to your generate-image server JavaScript file
- `YOUR_WORKER_API_TOKEN`: Your Cloudflare worker API token
- `YOUR_WORKER_URL`: Your Cloudflare worker URL

### Implementation Notes

The current implementation has the following characteristics:

**Current Approach:**
- ✅ Returns image name immediately, enabling quick client feedback
- ✅ Creates R2 file based on predictable naming pattern
- ⚠️ Client needs to poll or implement webhook handling for final image
- ⚠️ No guarantee that client receives final image URL

**Suggested Improvement:**
Consider implementing a webhook-based approach where:
1. Worker waits for Replicate completion
2. Stores image in R2
3. Calls back to MCP server with final URL
4. MCP server updates client with permanent URL

This would provide:
- More reliable image delivery confirmation
- Guaranteed final URL delivery to client
- Better error handling capabilities
- Reduced client complexity

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure R2:
   - In the Cloudflare dashboard, go to R2 > Buckets
   - Create two buckets:
     - Production bucket
     - Development bucket
   - For each bucket:
     - Click on "Settings"
     - Under "Public Access", create a public bucket URL
     - Copy the public bucket URL base (looks like `https://pub-{hash}.r2.dev`)

3. Configure Production Environment:
   Create a `wrangler.toml` file based on `wrangler.toml.example`:
   ```toml
   [[r2_buckets]]
   binding = "BUCKET"
   bucket_name = "YOUR_BUCKET_NAME"
   preview_bucket_name = "YOUR_PREVIEW_BUCKET_NAME"

   [vars]
   BUCKET_URL = "YOUR_BUCKET_URL"
   ```

4. Configure Development Environment:
   Create a `.dev.vars` file in the project root:
   ```
   WORKER_API_TOKEN=your_dev_token_here
   REPLICATE_API_TOKEN=your_replicate_dev_token_here
   REPLICATE_WEBHOOK_SECRET=your_webhook_secret_here
   BUCKET_URL=your_dev_bucket_url_here
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
WORKER_API_TOKEN=your_dev_token_here
REPLICATE_API_TOKEN=your_replicate_dev_token_here
REPLICATE_WEBHOOK_SECRET=your_webhook_secret_here
BUCKET_URL=your_dev_bucket_url_here
```

### Production (wrangler.toml + secrets)
Production uses a combination of wrangler.toml variables and secrets:
```toml
# wrangler.toml
[vars]
BUCKET_URL = "YOUR_BUCKET_URL"
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
- Production: `https://pub-{hash}.r2.dev/{bucket-name}/image.png`
- Development: `https://pub-{hash}.r2.dev/{preview-bucket-name}/image.png`

## Technical Implementation

- Uses the official Replicate SDK with built-in TypeScript support
- Standard model identification
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
  "model": "YOUR_MODEL_NAME"
}
```

See [API Documentation](API.md) for more detailed examples and webhook integration.
