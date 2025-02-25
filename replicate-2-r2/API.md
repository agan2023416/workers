# Replicate to R2 Worker API Documentation

## Overview
This worker provides a simplified interface for generating images using Replicate's API and automatically storing them in Cloudflare R2. It uses the official Replicate client library and implements secure webhook verification.

## Base URL
```
https://<your-worker-subdomain>.workers.dev
```

## Authentication
All requests must include an authorization token in the header:
```
Authorization: Bearer <WORKER_API_TOKEN>
```

## R2 Storage URLs

Images are stored in R2 with URLs following this structure:
```
https://pub-{hash}.r2.dev/{bucket-name}/{image-id}.png
```

For example:
- Production: `https://pub-fdc3b8e93c2c448289aad475393d1ecd.r2.dev/blog-gnc/1708840000000-ab1cd2.png`
- Development: `https://pub-fdc3b8e93c2c448289aad475393d1ecd.r2.dev/blog-gnc-dev/1708840000000-ab1cd2.png`

## Endpoints

### Generate Image
Generate an image using Replicate and store it in R2.

**Endpoint:** `/`  
**Method:** `POST`  
**Content-Type:** `application/json`

#### Request Body

```json
{
  "prompt": string,       // Required: The text prompt for image generation
  "model": string,       // Required: The model identifier (e.g., "black-forest-labs/flux-schnell")
  "version": string,     // Optional: Specific model version ID
  "webhook": string,     // Optional: Webhook URL for status updates
  "webhookEvents": string[] // Optional: Array of webhook events to receive
}
```

The `webhookEvents` array can include any of the following values:
- `"start"`: When the prediction starts
- `"output"`: When output is produced
- `"logs"`: When logs are generated
- `"completed"`: When the prediction is completed

Example:
```json
{
  "prompt": "A serene landscape with mountains and a lake at sunset",
  "model": "black-forest-labs/flux-schnell",
  "version": "39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b",
  "webhook": "https://your-app.com/webhooks/replicate",
  "webhookEvents": ["completed"]
}
```

#### Response

**Success Response (200 OK)**
```json
{
  "id": string,     // Prediction ID from Replicate
  "imageUrl": string,  // The URL where the image will be available
  "status": string    // Current status of the prediction
}
```

The `status` field will be one of:
- `"starting"`: The prediction is being started
- `"processing"`: The model is processing the request
- `"succeeded"`: The image has been successfully generated
- `"failed"`: The prediction failed
- `"canceled"`: The prediction was canceled

Example Response (Development):
```json
{
  "id": "rf3b2d4f9",
  "imageUrl": "https://pub-fdc3b8e93c2c448289aad475393d1ecd.r2.dev/blog-gnc-dev/1708840000000-ab1cd2.png",
  "status": "processing"
}
```

Example Response (Production):
```json
{
  "id": "rf3b2d4f9",
  "imageUrl": "https://pub-fdc3b8e93c2c448289aad475393d1ecd.r2.dev/blog-gnc/1708840000000-ab1cd2.png",
  "status": "processing"
}
```

## Webhook Integration

### Webhook Security
The worker implements Replicate's webhook signature verification to ensure webhook authenticity. Each webhook request includes three important headers:

- `webhook-id`: Unique identifier for the webhook message
- `webhook-timestamp`: Unix timestamp of when the webhook was sent
- `webhook-signature`: Base64-encoded signature(s) to verify the webhook

### Webhook Verification
The worker automatically verifies webhooks using:
1. Timestamp validation (within 5 minutes)
2. HMAC-SHA256 signature verification
3. Constant-time signature comparison

### Webhook Processing
When a valid webhook is received:
1. The worker verifies the signature using `REPLICATE_WEBHOOK_SECRET`
2. For successful predictions, the worker downloads the generated image
3. The image is stored in R2 at the previously generated URL
4. A 200 OK response is returned to acknowledge receipt

## Environment Variables

### Required Variables
- `WORKER_API_TOKEN`: Token for authenticating API requests
- `REPLICATE_API_TOKEN`: Your Replicate API token
- `REPLICATE_WEBHOOK_SECRET`: Your Replicate webhook signing secret (e.g., "whsec_Bp8sjqjLbzG6QGAQmxvH/tZOGAgnAZAu")
- `BUCKET`: R2 bucket binding
- `BUCKET_URL`: Public URL for the R2 bucket (includes bucket name)

## Error Responses

**401 Unauthorized**
```json
{
  "error": "Unauthorized"
}
```

**401 Invalid Webhook**
```json
{
  "error": "Invalid webhook signature"
}
```

**400 Bad Request**
```json
{
  "error": "Missing required fields"
}
```

**500 Internal Server Error**
```json
{
  "id": "",
  "imageUrl": "",
  "status": "failed",
  "error": "Error message details"
}
```

## Best Practices

1. **Webhook Security**:
   - Keep your `REPLICATE_WEBHOOK_SECRET` secure
   - Always verify webhook signatures
   - Check webhook timestamps to prevent replay attacks

2. **Error Handling**:
   - Implement retry logic for failed requests
   - Monitor webhook delivery status
   - Log webhook processing errors

3. **Resource Management**:
   - Monitor R2 storage usage
   - Implement cleanup for old images if needed
   - Track prediction statuses

4. **Development**:
   - Use the development environment for testing
   - Never use production secrets in development
   - Test webhook verification with sample payloads