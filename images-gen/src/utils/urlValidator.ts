/**
 * URL validation utilities for image processing
 */

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

// 默认配置
export const DEFAULT_VALIDATION_CONFIG: UrlValidationConfig = {
  timeout: 10000, // 10秒
  maxFileSize: 10 * 1024 * 1024, // 10MB
  allowedTypes: [
    'image/jpeg',
    'image/jpg', 
    'image/png',
    'image/webp',
    'image/gif',
    'image/svg+xml',
    'image/bmp',
    'image/tiff',
    'image/avif'
  ],
  userAgent: 'CloudflareWorker-ImageProcessor/1.0',
  maxRedirects: 5,
  followRedirects: true
};

/**
 * 验证URL是否为有效的图片链接
 */
export async function validateImageUrl(
  url: string, 
  config: Partial<UrlValidationConfig> = {}
): Promise<UrlValidationResult> {
  const finalConfig = { ...DEFAULT_VALIDATION_CONFIG, ...config };
  
  try {
    console.log(`Validating image URL: ${url}`);
    
    // 1. URL格式基础检查
    const basicValidation = validateUrlFormat(url);
    if (!basicValidation.isValid) {
      return basicValidation;
    }
    
    // 2. 执行HTTP HEAD请求检查
    const httpValidation = await validateHttpResponse(url, finalConfig);
    if (!httpValidation.isValid) {
      return httpValidation;
    }
    
    console.log(`URL validation successful: ${url}`);
    return httpValidation;
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown validation error';
    console.error(`URL validation failed for ${url}:`, errorMessage);
    
    return {
      isValid: false,
      error: `Validation failed: ${errorMessage}`
    };
  }
}

/**
 * 基础URL格式验证
 */
function validateUrlFormat(url: string): UrlValidationResult {
  try {
    const urlObj = new URL(url);
    
    // 检查协议
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return {
        isValid: false,
        error: `Invalid protocol: ${urlObj.protocol}. Only HTTP and HTTPS are supported.`
      };
    }
    
    // 检查主机名
    if (!urlObj.hostname) {
      return {
        isValid: false,
        error: 'Invalid hostname'
      };
    }
    
    // 检查是否为本地地址（安全考虑）
    const hostname = urlObj.hostname.toLowerCase();
    const localHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
    const privateRanges = ['10.', '172.16.', '172.17.', '172.18.', '172.19.', '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.', '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.', '192.168.'];
    
    if (localHosts.includes(hostname) || privateRanges.some(range => hostname.startsWith(range))) {
      return {
        isValid: false,
        error: 'Local and private network addresses are not allowed'
      };
    }
    
    return { isValid: true };
    
  } catch (error) {
    return {
      isValid: false,
      error: `Invalid URL format: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * HTTP响应验证
 */
async function validateHttpResponse(
  url: string, 
  config: UrlValidationConfig
): Promise<UrlValidationResult> {
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeout);
  
  try {
    // 执行HEAD请求
    const response = await fetch(url, {
      method: 'HEAD',
      headers: {
        'User-Agent': config.userAgent,
        'Accept': 'image/*',
        'Cache-Control': 'no-cache'
      },
      signal: controller.signal,
      redirect: config.followRedirects ? 'follow' : 'manual'
    });
    
    clearTimeout(timeoutId);
    
    // 检查HTTP状态码
    if (!response.ok) {
      // 特殊处理一些常见的状态码
      let errorMessage = `HTTP ${response.status}`;
      switch (response.status) {
        case 403:
          errorMessage += ' (Forbidden - Access denied)';
          break;
        case 404:
          errorMessage += ' (Not Found)';
          break;
        case 429:
          errorMessage += ' (Too Many Requests)';
          break;
        case 500:
          errorMessage += ' (Internal Server Error)';
          break;
        case 503:
          errorMessage += ' (Service Unavailable)';
          break;
      }
      
      return {
        isValid: false,
        error: errorMessage
      };
    }
    
    // 获取响应头信息
    const contentType = response.headers.get('content-type');
    const contentLength = response.headers.get('content-length');
    const finalUrl = response.url;
    
    // 验证Content-Type
    if (!contentType) {
      return {
        isValid: false,
        error: 'Missing Content-Type header'
      };
    }
    
    const isValidType = config.allowedTypes.some(type => 
      contentType.toLowerCase().includes(type.toLowerCase())
    );
    
    if (!isValidType) {
      return {
        isValid: false,
        error: `Invalid content type: ${contentType}. Expected image type.`
      };
    }
    
    // 验证文件大小
    if (contentLength) {
      const size = parseInt(contentLength);
      if (size > config.maxFileSize) {
        return {
          isValid: false,
          error: `File too large: ${formatFileSize(size)} (max: ${formatFileSize(config.maxFileSize)})`
        };
      }
    }
    
    return {
      isValid: true,
      contentType,
      contentLength: contentLength ? parseInt(contentLength) : undefined,
      finalUrl
    };
    
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        isValid: false,
        error: `Request timeout after ${config.timeout}ms`
      };
    }
    
    return {
      isValid: false,
      error: `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * 尝试下载图片并进行更深入的验证
 */
export async function validateAndDownloadImage(
  url: string,
  config: Partial<UrlValidationConfig> = {}
): Promise<{
  isValid: boolean;
  error?: string;
  imageBuffer?: ArrayBuffer;
  contentType?: string;
  finalUrl?: string;
}> {
  const finalConfig = { ...DEFAULT_VALIDATION_CONFIG, ...config };
  
  // 首先进行基础验证
  const basicValidation = await validateImageUrl(url, finalConfig);
  if (!basicValidation.isValid) {
    return {
      isValid: false,
      error: basicValidation.error
    };
  }
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), finalConfig.timeout);
  
  try {
    console.log(`Downloading image for validation: ${url}`);
    
    // 下载图片
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': finalConfig.userAgent,
        'Accept': 'image/*'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      return {
        isValid: false,
        error: `Download failed: HTTP ${response.status}`
      };
    }
    
    const imageBuffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    
    // 验证下载的文件大小
    if (imageBuffer.byteLength > finalConfig.maxFileSize) {
      return {
        isValid: false,
        error: `Downloaded file too large: ${formatFileSize(imageBuffer.byteLength)} (max: ${formatFileSize(finalConfig.maxFileSize)})`
      };
    }
    
    // 基础的图片格式验证（检查文件头）
    const formatValidation = validateImageFormat(imageBuffer, contentType);
    if (!formatValidation.isValid) {
      return formatValidation;
    }
    
    console.log(`Image download and validation successful: ${url} (${formatFileSize(imageBuffer.byteLength)})`);
    
    return {
      isValid: true,
      imageBuffer,
      contentType,
      finalUrl: response.url
    };
    
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        isValid: false,
        error: `Download timeout after ${finalConfig.timeout}ms`
      };
    }
    
    return {
      isValid: false,
      error: `Download failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * 验证图片格式（通过文件头）
 */
function validateImageFormat(buffer: ArrayBuffer, contentType: string): { isValid: boolean; error?: string } {
  const bytes = new Uint8Array(buffer);
  
  // 检查文件是否太小
  if (bytes.length < 8) {
    return {
      isValid: false,
      error: 'File too small to be a valid image'
    };
  }
  
  // 检查常见图片格式的文件头
  const signatures = {
    'image/jpeg': [[0xFF, 0xD8, 0xFF]],
    'image/png': [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
    'image/gif': [[0x47, 0x49, 0x46, 0x38, 0x37, 0x61], [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
    'image/webp': [[0x52, 0x49, 0x46, 0x46]], // RIFF header, WEBP comes later
    'image/bmp': [[0x42, 0x4D]],
    'image/tiff': [[0x49, 0x49, 0x2A, 0x00], [0x4D, 0x4D, 0x00, 0x2A]]
  };
  
  const normalizedContentType = contentType.toLowerCase();
  const expectedSignatures = signatures[normalizedContentType as keyof typeof signatures];
  
  if (expectedSignatures) {
    const hasValidSignature = expectedSignatures.some(signature => 
      signature.every((byte, index) => bytes[index] === byte)
    );
    
    if (!hasValidSignature) {
      return {
        isValid: false,
        error: `File signature doesn't match content type ${contentType}`
      };
    }
  }
  
  return { isValid: true };
}

/**
 * 格式化文件大小显示
 */
function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}
