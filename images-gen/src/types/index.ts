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
  // 新增：原文图片URL（可选）
  imageUrl?: string;

  // 原有：AI生成提示词（当imageUrl无效时必需）
  prompt?: string;

  // 原有：可选参数
  keyword?: string;
  articleId?: string;
  width?: number;
  height?: number;
  style?: string;
  provider?: 'replicate' | 'fal' | 'unsplash';
}

// 统一响应接口
export interface UnifiedImageResponse {
  // 统一返回R2存储的URL
  url: string;

  // 图片来源标识
  source: 'original' | 'replicate' | 'fal' | 'unsplash' | 'emergency-fallback';

  // 处理时间
  elapsedMs: number;

  // 成功标识
  success: boolean;

  // R2存储状态
  r2Stored?: boolean;

  // 错误信息（失败时）
  error?: string;

  // 可选：原始URL（当source为'original'时）
  originalUrl?: string;

  // 可选：使用的提示词（当source为AI生成时）
  usedPrompt?: string;

  // 详细错误信息（失败时）
  details?: {
    originalUrlError?: string;
    aiGenerationError?: string;
    r2StorageError?: string;
  };
}

// 保持向后兼容的原响应接口
export interface GenerateImageResponse {
  url: string;
  provider: ImageProvider;
  elapsedMs: number;
  success: boolean;
  error?: string;
}

// Provider types
export type ImageProvider = 'replicate' | 'fal' | 'unsplash' | 'default';
export type ImageSource = 'original' | 'replicate' | 'fal' | 'unsplash' | 'emergency-fallback';

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
  // 新增：URL验证配置
  urlValidation?: UrlValidationConfig;
  // 新增：图片下载配置
  imageDownload?: {
    timeout: number;
    retries: number;
    retryDelay: number;
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

// URL验证相关类型
export interface UrlValidationResult {
  isValid: boolean;
  error?: string;
  contentType?: string;
  contentLength?: number;
  finalUrl?: string; // After redirects
}

export interface UrlValidationConfig {
  timeout: number;           // 验证超时时间 (ms)
  maxFileSize: number;       // 最大文件大小 (bytes)
  allowedTypes: string[];    // 允许的MIME类型
  userAgent: string;         // 请求User-Agent
  maxRedirects: number;      // 最大重定向次数
  followRedirects: boolean;  // 是否跟随重定向
}

// 图片处理结果类型
export interface ImageProcessingResult {
  success: boolean;
  source: ImageSource;
  url: string;
  originalUrl?: string;
  usedPrompt?: string;
  elapsedMs: number;
  error?: string;
  details?: {
    urlValidation?: UrlValidationResult;
    downloadError?: string;
    aiGenerationError?: string;
    r2StorageError?: string;
  };
}

// 处理步骤日志类型
export interface ProcessingStep {
  step: 'url_validation' | 'url_download' | 'ai_generation' | 'r2_storage';
  status: 'success' | 'failure';
  duration: number;
  error?: string;
  details?: any;
}

export interface ProcessingLog {
  requestId: string;
  timestamp: string;
  imageUrl?: string;
  prompt?: string;
  articleId?: string;
  steps: ProcessingStep[];
  finalResult: {
    source: ImageSource;
    url: string;
    success: boolean;
  };
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
