# Images Generation Worker

A unified image generation worker for article publishing workflow, built on Cloudflare Workers. This service provides "one-click image generation" capability by integrating multiple AI image generation providers with automatic fallback mechanisms.

## Features

- **Multi-Provider Support**: Integrates Replicate, Fal, and Unsplash with parallel racing
- **Automatic Fallback**: Circuit breaker pattern with graceful degradation to default images
- **R2 Storage**: All generated images are stored in Cloudflare R2 with CDN URLs
- **Real-time Monitoring**: Built-in analytics and state tracking
- **Hot Configuration**: Runtime configuration updates without redeployment
- **High Availability**: 99.9% uptime with comprehensive error handling

## Quick Start

### Prerequisites

- Node.js 18+ and pnpm
- Cloudflare account with Workers and R2 enabled
- API keys for image generation providers (optional but recommended)

### Installation

```bash
# Clone and install dependencies
git clone <repository-url>
cd images-gen
pnpm install

# Configure Wrangler
pnpm wrangler login
```

### Configuration

1. **Create R2 Bucket**:
```bash
pnpm wrangler r2 bucket create images-gen-storage
```

2. **Create KV Namespaces**:
```bash
pnpm wrangler kv:namespace create "STATE_KV"
pnpm wrangler kv:namespace create "CONFIG_KV"
```

3. **Update wrangler.toml** with your namespace IDs

4. **Set Secrets**:
```bash
# Required for full functionality
pnpm wrangler secret put REPLICATE_API_TOKEN
pnpm wrangler secret put FAL_KEY
pnpm wrangler secret put UNSPLASH_ACCESS_KEY

# Optional: Custom R2 domain
pnpm wrangler secret put R2_CUSTOM_DOMAIN
```

### Deployment

```bash
# Development
pnpm run dev

# Staging
pnpm run deploy:staging

# Production
pnpm run deploy:production
```

## API Reference

### Generate Image

**POST** `/images/generate`

Generate an image from a text prompt with automatic provider selection and fallback.

#### Request Body

```json
{
  "prompt": "A beautiful sunset over mountains",
  "keyword": "landscape",
  "articleId": "article-123",
  "width": 1024,
  "height": 768,
  "style": "photorealistic"
}
```

#### Response

```json
{
  "url": "https://your-cdn.com/ai/2024/01/uuid.webp",
  "provider": "replicate",
  "elapsedMs": 2500,
  "success": true
}
```

#### Error Response

```json
{
  "url": "https://via.placeholder.com/1024x768/4A90E2/FFFFFF?text=Default+Image",
  "provider": "default",
  "elapsedMs": 30000,
  "success": false,
  "error": "All providers failed: timeout"
}
```

### Health Check

**GET** `/health`

Returns service health status.

### Configuration

**GET** `/config`

Returns current configuration (public settings only).

## Admin Endpoints

Admin endpoints require authentication via `Authorization: Bearer <token>` header.

### Status

**GET** `/admin/status`

Comprehensive service status including provider health and configuration validation.

### Statistics

**GET** `/admin/stats?days=7`

Get aggregated statistics for the specified number of days.

**GET** `/admin/stats?date=2024-01-15`

Get statistics for a specific date.

### Providers

**GET** `/admin/providers`

Get detailed provider status including circuit breaker states.

### Storage

**GET** `/admin/storage`

Get R2 storage statistics and usage information.

### Circuit Breaker

**GET** `/admin/circuit-breaker`

Get circuit breaker status for all providers.

**POST** `/admin/circuit-breaker`

Reset circuit breakers:

```json
{
  "action": "reset",
  "provider": "replicate"
}
```

Or reset all:

```json
{
  "action": "reset-all"
}
```

## Configuration Management

### Runtime Configuration

Configuration can be updated at runtime via KV storage:

```bash
# Update provider timeouts
pnpm wrangler kv:key put --binding=CONFIG_KV "app-config" '{
  "providers": {
    "replicate": {
      "timeout": 120000
    }
  }
}'
```

### Default Configuration

```json
{
  "providers": {
    "replicate": {
      "enabled": true,
      "timeout": 180000,
      "retries": 0,
      "priority": 1
    },
    "fal": {
      "enabled": true,
      "timeout": 15000,
      "retries": 2,
      "priority": 2
    },
    "unsplash": {
      "enabled": true,
      "timeout": 5000,
      "retries": 1,
      "priority": 3
    }
  },
  "r2": {
    "pathPrefix": "ai",
    "cacheControl": "public, max-age=31536000, immutable"
  },
  "defaults": {
    "timeout": 30000,
    "imageUrl": "https://via.placeholder.com/1024x768/4A90E2/FFFFFF?text=Default+Image"
  }
}
```

## Monitoring

### Analytics

The service automatically sends analytics to Cloudflare Analytics Engine:

- Request counts by provider and status
- Response times and error rates
- Circuit breaker state changes

### Logging

Structured logging is available in Cloudflare Workers dashboard:

- Request/response details
- Provider performance metrics
- Error traces and debugging information

### Alerts

Set up alerts based on:

- Provider success rates < 50% over 10 minutes
- Overall error rate > 5%
- Average response time > 10 seconds

## Development

### Local Development

```bash
# Start development server
pnpm run dev

# Run tests
pnpm test

# Type checking
pnpm run type-check

# Linting
pnpm run lint
```

### Project Structure

```
src/
├── config/           # Configuration management
├── services/         # Core business logic
│   ├── providers/    # Image generation providers
│   ├── imageGenerator.ts
│   ├── r2Storage.ts
│   ├── stateTracker.ts
│   └── adminEndpoints.ts
├── types/            # TypeScript type definitions
├── utils/            # Utility functions
└── index.ts          # Worker entry point
```

## Troubleshooting

### Common Issues

1. **No images generated**: Check provider API keys and quotas
2. **Slow responses**: Adjust provider timeouts in configuration
3. **R2 upload failures**: Verify R2 bucket permissions and custom domain setup
4. **Circuit breaker open**: Reset via admin endpoint or wait for automatic recovery

### Debug Mode

Enable debug logging by setting `LOG_LEVEL=debug` in environment variables.

## Security

- All API keys are stored as Cloudflare Secrets
- Sensitive information is automatically redacted from logs
- Admin endpoints require authentication
- Input validation prevents injection attacks
- Rate limiting can be configured per environment

## Performance

- **Average Response Time**: 2-5 seconds (depending on provider)
- **Throughput**: 100+ requests/minute per worker
- **Availability**: 99.9% uptime with fallback mechanisms
- **Storage**: Unlimited via Cloudflare R2

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:

1. Check the troubleshooting section
2. Review Cloudflare Workers logs
3. Use admin endpoints for diagnostics
4. Contact the development team
