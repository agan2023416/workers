// Environment bindings interface
export interface Env {
  // Secrets
  REPLICATE_API_TOKEN: string;
  FAL_KEY: string;
  UNSPLASH_ACCESS_KEY: string;
  R2_CUSTOM_DOMAIN?: string;

  // Environment variables
  ENVIRONMENT: 'development' | 'staging' | 'production';

  // Bindings
  IMAGES_BUCKET: R2Bucket;
  STATE_KV: KVNamespace;
  CONFIG_KV: KVNamespace;
  ANALYTICS?: AnalyticsEngineDataset;
}

// Cloudflare Workers types
declare global {
  interface ExecutionContext {
    waitUntil(promise: Promise<any>): void;
    passThroughOnException(): void;
  }

  interface R2Bucket {
    put(key: string, value: ArrayBuffer | ReadableStream, options?: R2PutOptions): Promise<R2Object>;
    get(key: string, options?: R2GetOptions): Promise<R2ObjectBody | null>;
    head(key: string): Promise<R2Object | null>;
    delete(key: string): Promise<void>;
    list(options?: R2ListOptions): Promise<R2Objects>;
  }

  interface R2Object {
    key: string;
    size: number;
    etag: string;
    uploaded: Date;
    httpMetadata?: R2HTTPMetadata;
    customMetadata?: Record<string, string>;
  }

  interface R2ObjectBody extends R2Object {
    body: ReadableStream;
    bodyUsed: boolean;
    arrayBuffer(): Promise<ArrayBuffer>;
    text(): Promise<string>;
    json(): Promise<any>;
    blob(): Promise<Blob>;
  }

  interface R2Objects {
    objects: R2Object[];
    truncated: boolean;
    cursor?: string;
  }

  interface R2PutOptions {
    httpMetadata?: R2HTTPMetadata;
    customMetadata?: Record<string, string>;
  }

  interface R2GetOptions {
    range?: R2Range;
  }

  interface R2ListOptions {
    limit?: number;
    prefix?: string;
    cursor?: string;
    delimiter?: string;
  }

  interface R2HTTPMetadata {
    contentType?: string;
    contentLanguage?: string;
    contentDisposition?: string;
    contentEncoding?: string;
    cacheControl?: string;
    cacheExpiry?: Date;
  }

  interface R2Range {
    offset?: number;
    length?: number;
    suffix?: number;
  }

  interface KVNamespace {
    get(key: string, options?: KVNamespaceGetOptions): Promise<string | null>;
    put(key: string, value: string, options?: KVNamespacePutOptions): Promise<void>;
    delete(key: string): Promise<void>;
    list(options?: KVNamespaceListOptions): Promise<KVNamespaceListResult>;
  }

  interface KVNamespaceGetOptions {
    type?: 'text' | 'json' | 'arrayBuffer' | 'stream';
    cacheTtl?: number;
  }

  interface KVNamespacePutOptions {
    expirationTtl?: number;
    expiration?: number;
    metadata?: any;
  }

  interface KVNamespaceListOptions {
    limit?: number;
    prefix?: string;
    cursor?: string;
  }

  interface KVNamespaceListResult {
    keys: KVNamespaceListKey[];
    list_complete: boolean;
    cursor?: string;
  }

  interface KVNamespaceListKey {
    name: string;
    expiration?: number;
    metadata?: any;
  }

  interface AnalyticsEngineDataset {
    writeDataPoint(event: AnalyticsEngineDataPoint): Promise<void>;
  }

  interface AnalyticsEngineDataPoint {
    blobs?: string[];
    doubles?: number[];
    indexes?: string[];
  }
}

// Request/Response types
export interface GenerateImageRequest {
  prompt: string;
  keyword?: string;
  articleId?: string;
  width?: number;
  height?: number;
  style?: string;
  provider?: 'replicate' | 'fal' | 'unsplash';
}

export interface GenerateImageResponse {
  url: string;
  provider: ImageProvider;
  elapsedMs: number;
  success: boolean;
  error?: string;
}

// Provider types
export type ImageProvider = 'replicate' | 'fal' | 'unsplash' | 'default';

export interface ProviderResult {
  success: boolean;
  url?: string;
  provider: ImageProvider;
  error?: string;
  elapsedMs: number;
}

// Configuration types
export interface ProviderConfig {
  enabled: boolean;
  timeout: number;
  retries: number;
  priority: number;
}

export interface AppConfig {
  providers: {
    replicate: ProviderConfig;
    fal: ProviderConfig;
    unsplash: ProviderConfig;
  };
  r2: {
    pathPrefix: string;
    cacheControl: string;
    customDomain?: string;
  };
  defaults: {
    timeout: number;
    imageUrl: string;
  };
}

// State tracking types
export interface GenerationState {
  id: string;
  provider: ImageProvider;
  url: string;
  elapsedMs: number;
  createdAt: string;
  prompt: string;
  articleId?: string;
  success: boolean;
  error?: string;
}

// Provider-specific types
export interface ReplicateResponse {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: string[];
  error?: string;
}

export interface FalResponse {
  images: Array<{
    url: string;
    width: number;
    height: number;
  }>;
}

export interface UnsplashResponse {
  id?: string;
  urls: {
    raw: string;
    full: string;
    regular: string;
    small: string;
    thumb: string;
  };
  user: {
    name: string;
    username: string;
  };
  description?: string;
}

// Error types
export class ImageGenerationError extends Error {
  constructor(
    message: string,
    public provider: ImageProvider,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'ImageGenerationError';
  }
}

export class TimeoutError extends Error {
  constructor(message: string, public timeoutMs: number) {
    super(message);
    this.name = 'TimeoutError';
  }
}

// Utility types
export interface AbortablePromise<T> extends Promise<T> {
  abort?: () => void;
}

export interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffFactor: number;
}
