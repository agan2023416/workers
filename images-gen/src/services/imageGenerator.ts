import {
  GenerateImageRequest,
  ProviderResult,
  Env,
  AppConfig,
  ImageGenerationError
} from '@/types';
import { getEnabledProviders } from '@/config';
import { createAbortablePromise } from '@/utils/common';
import { uploadToR2 } from '@/services/r2Storage';
import { generateWithReplicate } from '@/services/providers/replicate';
import { generateWithFal } from '@/services/providers/fal';
import { generateWithUnsplash } from '@/services/providers/unsplash';
import { ErrorHandler, globalCircuitBreaker } from '@/utils/errorHandler';

/**
 * Race providers with priority - higher priority providers get a head start
 */
async function raceWithPriority(
  availableProviders: Array<{ name: keyof any; config: any }>,
  request: GenerateImageRequest,
  env: Env,
  errorHandler: ErrorHandler,
  abortController: AbortController
): Promise<ProviderResult> {
  const results: Promise<ProviderResult>[] = [];
  // Give AI providers fair time: Replicate starts immediately, Fal after 3s, Unsplash after 15s
  const delays = [0, 3000, 15000]; // 0ms, 3s, 15s delays for priority 1, 2, 3

  // Start providers with staggered delays based on priority
  availableProviders.forEach(({ name, config: providerConfig }, index) => {
    const delay = delays[Math.min(index, delays.length - 1)] || 15000;

    const providerPromise = new Promise<ProviderResult>((resolve, reject) => {
      setTimeout(async () => {
        try {
          console.log(`Starting provider ${name} with ${delay}ms delay (priority ${index + 1})`);
          const result = await generateWithProvider(name, request, env, providerConfig, errorHandler);
          console.log(`Provider ${name} completed successfully`);
          resolve(result);
        } catch (error) {
          console.log(`Provider ${name} failed:`, error);
          reject(error);
        }
      }, delay);
    });

    results.push(createAbortablePromise(providerPromise, abortController));
  });

  // Return first successful result
  return await Promise.any(results);
}

/**
 * Main image generation function with parallel racing and fallback
 */
export async function generateImage(
  request: GenerateImageRequest,
  env: Env,
  config: AppConfig
): Promise<ProviderResult> {
  const errorHandler = new ErrorHandler(env, config);
  const enabledProviders = getEnabledProviders(config);

  if (enabledProviders.length === 0) {
    console.warn('No providers enabled, returning fallback image');
    return errorHandler.getFallbackResult();
  }

  // Filter providers by circuit breaker status
  const availableProviders = enabledProviders.filter(({ name }) =>
    globalCircuitBreaker.isProviderAvailable(name as any)
  );

  if (availableProviders.length === 0) {
    console.warn('All providers unavailable due to circuit breaker, returning fallback image');
    return errorHandler.getFallbackResult();
  }

  // Create abort controller for canceling slower requests
  const abortController = new AbortController();

  try {
    let result: ProviderResult;

    if (request.provider) {
      // Specific provider requested
      const requestedProvider = availableProviders.find(({ name }) => name === request.provider);
      if (requestedProvider) {
        console.log(`Using requested provider: ${request.provider}`);
        result = await generateWithProvider(
          requestedProvider.name,
          request,
          env,
          requestedProvider.config,
          errorHandler
        );
      } else {
        throw new Error(`Requested provider '${request.provider}' is not available`);
      }
    } else {
      // Priority-based racing: give higher priority providers a head start
      result = await raceWithPriority(availableProviders, request, env, errorHandler, abortController);
    }

    // Cancel remaining requests
    abortController.abort();

    // Record success in circuit breaker
    globalCircuitBreaker.recordSuccess(result.provider);

    // Upload successful result to R2 (enabled for testing)
    if (result.success && result.url) {
      try {
        console.log(`Uploading image to R2: ${result.url}`);
        const r2Url = await uploadToR2(result.url, env, config);
        console.log(`R2 upload successful: ${r2Url}`);
        return {
          ...result,
          url: r2Url,
        };
      } catch (uploadError) {
        console.error('Failed to upload to R2:', uploadError);
        // Return original URL if R2 upload fails
        console.log('Falling back to original URL');
        return result;
      }
    }

    return result;
  } catch (error) {
    // All providers failed
    abortController.abort();

    if (error instanceof AggregateError) {
      const errors = error.errors.map(e => e.message).join('; ');
      console.error('All providers failed:', errors);

      // Record failures in circuit breaker
      availableProviders.forEach(({ name }) => {
        globalCircuitBreaker.recordFailure(name as any);
      });

      // Return fallback image instead of throwing
      console.warn('All providers failed, returning fallback image');
      return errorHandler.getFallbackResult();
    }

    // For other errors, still return fallback
    console.error('Unexpected error in image generation:', error);
    return errorHandler.getFallbackResult();
  }
}

/**
 * Generate image with specific provider
 */
async function generateWithProvider(
  providerName: keyof AppConfig['providers'],
  request: GenerateImageRequest,
  env: Env,
  providerConfig: any,
  errorHandler: ErrorHandler
): Promise<ProviderResult> {
  const startTime = Date.now();

  try {
    let result: ProviderResult;

    switch (providerName) {
      case 'replicate':
        result = await generateWithReplicate(request, env, providerConfig);
        break;
      case 'fal':
        result = await generateWithFal(request, env, providerConfig);
        break;
      case 'unsplash':
        result = await generateWithUnsplash(request, env, providerConfig);
        break;
      default:
        throw new ImageGenerationError(`Unknown provider: ${providerName}`, providerName as any);
    }

    const elapsedMs = Date.now() - startTime;

    if (result.success) {
      // Record success
      globalCircuitBreaker.recordSuccess(providerName as any);
    } else {
      // Record failure
      globalCircuitBreaker.recordFailure(providerName as any);
    }

    return {
      ...result,
      elapsedMs,
    };
  } catch (error) {
    const elapsedMs = Date.now() - startTime;

    // Record failure in circuit breaker
    globalCircuitBreaker.recordFailure(providerName as any);

    // Handle error with error handler
    const errorResult = await errorHandler.handleProviderError(
      error instanceof Error ? error : new Error(String(error)),
      providerName as any,
      'generation'
    );

    return {
      ...errorResult,
      elapsedMs,
    };
  }
}

/**
 * Generate fallback image URL
 */
export function generateFallbackImage(config: AppConfig): ProviderResult {
  return {
    success: false,
    url: config.defaults.imageUrl,
    provider: 'default',
    error: 'Using fallback image due to provider failures',
    elapsedMs: 0,
  };
}
