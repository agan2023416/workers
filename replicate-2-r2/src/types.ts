/// <reference types="@cloudflare/workers-types" />

export interface Env {
  WORKER_API_TOKEN: string;
  REPLICATE_API_TOKEN: string;
  REPLICATE_WEBHOOK_SECRET: string;
  BUCKET: R2Bucket;
  BUCKET_URL: string;
}

// Only define our worker-specific interfaces
export interface WorkerRequest {
  prompt: string;
  model: string;       // e.g., "black-forest-labs/flux-schnell"
  version?: string;    // Optional: specific model version
  webhook?: string;
  webhookEvents?: Array<'start' | 'output' | 'logs' | 'completed'>;
}

export interface WorkerResponse {
  id: string;
  imageUrl: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  error?: string;
}

export interface WebhookHeaders {
  'webhook-id': string;
  'webhook-timestamp': string;
  'webhook-signature': string;
}