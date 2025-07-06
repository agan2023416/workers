import { AppConfig, Env } from '@/types';

// Default configuration
export const DEFAULT_CONFIG: AppConfig = {
  providers: {
    replicate: {
      enabled: true, // Re-enabled for testing
      timeout: 30000, // 30 seconds (reduced from 3 minutes for testing)
      retries: 0, // No retries for webhook-based service
      priority: 1, // Highest priority
    },
    fal: {
      enabled: true,
      timeout: 20000, // 20 seconds (increased for fair racing)
      retries: 2,
      priority: 2, // Second priority
    },
    unsplash: {
      enabled: true,
      timeout: 5000, // 5 seconds
      retries: 1,
      priority: 3, // Fallback only
    },
  },
  r2: {
    pathPrefix: 'ai',
    cacheControl: 'public, max-age=31536000, immutable',
  },
  defaults: {
    timeout: 30000, // 30 seconds total
    imageUrl: 'https://via.placeholder.com/1024x768/4A90E2/FFFFFF?text=Default+Image',
  },
};

// Configuration cache
let configCache: AppConfig | null = null;
let configCacheExpiry = 0;
const CONFIG_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Get application configuration with hot reload support
 */
export async function getConfig(env: Env): Promise<AppConfig> {
  const now = Date.now();
  
  // Return cached config if still valid
  if (configCache && now < configCacheExpiry) {
    return configCache;
  }

  try {
    // Try to load config from KV
    const configJson = await env.CONFIG_KV.get('app-config');
    if (configJson) {
      const config = JSON.parse(configJson) as Partial<AppConfig>;
      configCache = mergeConfig(DEFAULT_CONFIG, config);
    } else {
      configCache = DEFAULT_CONFIG;
    }
  } catch (error) {
    console.warn('Failed to load config from KV, using defaults:', error);
    configCache = DEFAULT_CONFIG;
  }

  // Apply environment-specific overrides
  if (env.R2_CUSTOM_DOMAIN) {
    configCache.r2.customDomain = env.R2_CUSTOM_DOMAIN;
  }

  configCacheExpiry = now + CONFIG_CACHE_TTL;
  return configCache;
}

/**
 * Update configuration in KV store
 */
export async function updateConfig(env: Env, config: Partial<AppConfig>): Promise<void> {
  const currentConfig = await getConfig(env);
  const newConfig = mergeConfig(currentConfig, config);
  
  await env.CONFIG_KV.put('app-config', JSON.stringify(newConfig));
  
  // Invalidate cache
  configCache = null;
  configCacheExpiry = 0;
}

/**
 * Merge configuration objects deeply
 */
function mergeConfig(base: AppConfig, override: Partial<AppConfig>): AppConfig {
  return {
    providers: {
      replicate: { ...base.providers.replicate, ...override.providers?.replicate },
      fal: { ...base.providers.fal, ...override.providers?.fal },
      unsplash: { ...base.providers.unsplash, ...override.providers?.unsplash },
    },
    r2: { ...base.r2, ...override.r2 },
    defaults: { ...base.defaults, ...override.defaults },
  };
}

/**
 * Validate configuration
 */
export function validateConfig(config: AppConfig): string[] {
  const errors: string[] = [];

  // Validate provider configs
  Object.entries(config.providers).forEach(([name, providerConfig]) => {
    if (providerConfig.timeout <= 0) {
      errors.push(`Provider ${name}: timeout must be positive`);
    }
    if (providerConfig.retries < 0) {
      errors.push(`Provider ${name}: retries must be non-negative`);
    }
    if (providerConfig.priority <= 0) {
      errors.push(`Provider ${name}: priority must be positive`);
    }
  });

  // Validate R2 config
  if (!config.r2.pathPrefix) {
    errors.push('R2 pathPrefix cannot be empty');
  }
  if (!config.r2.cacheControl) {
    errors.push('R2 cacheControl cannot be empty');
  }

  // Validate defaults
  if (config.defaults.timeout <= 0) {
    errors.push('Default timeout must be positive');
  }
  if (!config.defaults.imageUrl) {
    errors.push('Default image URL cannot be empty');
  }

  return errors;
}

/**
 * Get enabled providers sorted by priority
 */
export function getEnabledProviders(config: AppConfig): Array<{ name: keyof AppConfig['providers']; config: any }> {
  return Object.entries(config.providers)
    .filter(([, providerConfig]) => providerConfig.enabled)
    .sort(([, a], [, b]) => a.priority - b.priority)
    .map(([name, providerConfig]) => ({ 
      name: name as keyof AppConfig['providers'], 
      config: providerConfig 
    }));
}
