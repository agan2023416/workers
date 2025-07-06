import { Env, ImageProvider } from '@/types';
import { validateFalKey } from '@/services/providers/fal';
import { validateUnsplashKey } from '@/services/providers/unsplash';

/**
 * Secrets manager for secure handling of API keys and tokens
 */
export class SecretsManager {
  private env: Env;
  private validationCache: Map<string, { isValid: boolean; lastChecked: number }> = new Map();
  private readonly VALIDATION_CACHE_TTL = 60 * 60 * 1000; // 1 hour

  constructor(env: Env) {
    this.env = env;
  }

  /**
   * Get API key for a specific provider
   */
  getProviderKey(provider: ImageProvider): string | null {
    switch (provider) {
      case 'replicate':
        return this.env.REPLICATE_API_TOKEN || null;
      case 'fal':
        return this.env.FAL_KEY || null;
      case 'unsplash':
        return this.env.UNSPLASH_ACCESS_KEY || null;
      default:
        return null;
    }
  }

  /**
   * Check if provider has valid credentials
   */
  hasValidCredentials(provider: ImageProvider): boolean {
    const key = this.getProviderKey(provider);
    return key !== null && key.trim().length > 0;
  }

  /**
   * Validate provider credentials (with caching)
   */
  async validateProviderCredentials(provider: ImageProvider): Promise<boolean> {
    const key = this.getProviderKey(provider);
    if (!key) {
      return false;
    }

    // Check cache first
    const cacheKey = `${provider}:${key.substring(0, 10)}`;
    const cached = this.validationCache.get(cacheKey);
    if (cached && Date.now() - cached.lastChecked < this.VALIDATION_CACHE_TTL) {
      return cached.isValid;
    }

    // Validate credentials
    let isValid = false;
    try {
      switch (provider) {
        case 'replicate':
          isValid = await this.validateReplicateKey(key);
          break;
        case 'fal':
          isValid = await validateFalKey(key);
          break;
        case 'unsplash':
          isValid = await validateUnsplashKey(key);
          break;
        default:
          isValid = false;
      }
    } catch (error) {
      console.error(`Failed to validate ${provider} credentials:`, error);
      isValid = false;
    }

    // Cache result
    this.validationCache.set(cacheKey, {
      isValid,
      lastChecked: Date.now(),
    });

    return isValid;
  }

  /**
   * Validate all provider credentials
   */
  async validateAllCredentials(): Promise<Record<ImageProvider, boolean>> {
    const providers: ImageProvider[] = ['replicate', 'fal', 'unsplash'];
    const results: Record<ImageProvider, boolean> = {} as any;

    await Promise.all(
      providers.map(async provider => {
        results[provider] = await this.validateProviderCredentials(provider);
      })
    );

    return results;
  }

  /**
   * Get credentials status summary
   */
  async getCredentialsStatus(): Promise<CredentialsStatus> {
    const validations = await this.validateAllCredentials();
    const configured = Object.keys(validations).filter(provider => 
      this.hasValidCredentials(provider as ImageProvider)
    ).length;
    const valid = Object.values(validations).filter(Boolean).length;

    return {
      configured,
      valid,
      total: 3,
      providers: validations,
      lastChecked: new Date().toISOString(),
    };
  }

  /**
   * Mask sensitive information in logs
   */
  maskSecret(secret: string): string {
    if (!secret || secret.length < 8) {
      return '[REDACTED]';
    }
    return `${secret.substring(0, 4)}...${secret.substring(secret.length - 4)}`;
  }

  /**
   * Validate Replicate API token
   */
  private async validateReplicateKey(token: string): Promise<boolean> {
    try {
      const response = await fetch('https://api.replicate.com/v1/account', {
        headers: {
          'Authorization': `Token ${token}`,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Clear validation cache
   */
  clearValidationCache(): void {
    this.validationCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    const now = Date.now();
    let validEntries = 0;
    let expiredEntries = 0;

    this.validationCache.forEach(entry => {
      if (now - entry.lastChecked < this.VALIDATION_CACHE_TTL) {
        validEntries++;
      } else {
        expiredEntries++;
      }
    });

    return {
      totalEntries: this.validationCache.size,
      validEntries,
      expiredEntries,
      cacheHitRate: validEntries / Math.max(this.validationCache.size, 1),
    };
  }
}

/**
 * Environment validator
 */
export class EnvironmentValidator {
  private env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  /**
   * Validate environment configuration
   */
  validateEnvironment(): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check required bindings
    if (!this.env.IMAGES_BUCKET) {
      errors.push('IMAGES_BUCKET binding is missing');
    }

    if (!this.env.STATE_KV) {
      errors.push('STATE_KV binding is missing');
    }

    if (!this.env.CONFIG_KV) {
      errors.push('CONFIG_KV binding is missing');
    }

    if (!this.env.ANALYTICS) {
      warnings.push('ANALYTICS binding is missing - analytics will be disabled');
    }

    // Check environment variable
    if (!this.env.ENVIRONMENT) {
      warnings.push('ENVIRONMENT variable is not set');
    } else if (!['development', 'staging', 'production'].includes(this.env.ENVIRONMENT)) {
      warnings.push(`Unknown environment: ${this.env.ENVIRONMENT}`);
    }

    // Check secrets
    const secretsManager = new SecretsManager(this.env);
    const hasReplicate = secretsManager.hasValidCredentials('replicate');
    const hasFal = secretsManager.hasValidCredentials('fal');
    const hasUnsplash = secretsManager.hasValidCredentials('unsplash');

    if (!hasReplicate && !hasFal && !hasUnsplash) {
      errors.push('No provider credentials configured');
    } else {
      if (!hasReplicate) warnings.push('Replicate API token not configured');
      if (!hasFal) warnings.push('Fal API key not configured');
      if (!hasUnsplash) warnings.push('Unsplash access key not configured');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      checkedAt: new Date().toISOString(),
    };
  }
}

// Type definitions
interface CredentialsStatus {
  configured: number;
  valid: number;
  total: number;
  providers: Record<ImageProvider, boolean>;
  lastChecked: string;
}

interface CacheStats {
  totalEntries: number;
  validEntries: number;
  expiredEntries: number;
  cacheHitRate: number;
}

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  checkedAt: string;
}
