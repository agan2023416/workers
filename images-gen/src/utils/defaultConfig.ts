import { AppConfig } from '../types';

const DEFAULT_FALLBACK_IMAGE = 'https://via.placeholder.com/1024x768/4A90E2/FFFFFF?text=Default+Image';

/**
 * Get default configuration for the application
 */
export function getDefaultConfig(): AppConfig {
  return {
    providers: {
      replicate: {
        enabled: true,
        timeout: 180000,
        retries: 0,
        priority: 1
      },
      fal: {
        enabled: true,
        timeout: 15000,
        retries: 2,
        priority: 2
      },
      unsplash: {
        enabled: true,
        timeout: 5000,
        retries: 1,
        priority: 3
      }
    },
    r2: {
      pathPrefix: 'ai',
      cacheControl: 'public, max-age=31536000, immutable'
    },
    defaults: {
      timeout: 30000,
      imageUrl: DEFAULT_FALLBACK_IMAGE,
      model: 'flux-1.1-pro'  // 默认使用flux 1.1 pro
    },
    models: {
      replicate: {
        'flux-1.1-pro': 'black-forest-labs/flux-1.1-pro',
        'flux-1.1-dev': 'black-forest-labs/flux-dev',
        'flux-schnell': 'black-forest-labs/flux-schnell',
        'ideogram-turbo': 'ideogram-ai/ideogram-v3-turbo',
        'ideogram-3.0': 'ideogram-ai/ideogram-v2'
      },
      fal: {
        'flux-1.1-pro': 'fal-ai/flux-pro', // Fal只有FLUX.1 [pro]，没有1.1版本
        'flux-1.1-dev': 'fal-ai/flux/dev',
        'flux-schnell': 'fal-ai/flux/schnell',
        'ideogram-turbo': 'fal-ai/ideogram/v2/turbo',
        'ideogram-3.0': 'fal-ai/ideogram/v3'
      }
    },
    urlValidation: {
      timeout: 10000,
      maxFileSize: 10 * 1024 * 1024,
      allowedTypes: [
        'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
        'image/gif', 'image/svg+xml', 'image/bmp', 'image/tiff'
      ],
      userAgent: 'CloudflareWorker-ImageProcessor/1.0',
      maxRedirects: 5,
      followRedirects: true
    },
    imageDownload: {
      timeout: 15000,
      retries: 2,
      retryDelay: 1000
    }
  };
}

/**
 * Map source to provider for backward compatibility
 */
export function mapSourceToProvider(source: string): string {
  switch (source) {
    case 'original':
      return 'original';
    case 'replicate':
      return 'replicate';
    case 'fal':
      return 'fal';
    case 'unsplash':
      return 'unsplash';
    case 'emergency-fallback':
      return 'default';
    default:
      return 'default';
  }
}
