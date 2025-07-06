import { 
  ImageGenerationError, 
  TimeoutError, 
  ProviderResult, 
  ImageProvider,
  Env,
  AppConfig 
} from '@/types';

/**
 * Enhanced error handler with fallback mechanisms
 */
export class ErrorHandler {
  private env: Env;
  private config: AppConfig;

  constructor(env: Env, config: AppConfig) {
    this.env = env;
    this.config = config;
  }

  /**
   * Handle provider error with appropriate fallback
   */
  async handleProviderError(
    error: Error,
    provider: ImageProvider,
    context: string
  ): Promise<ProviderResult> {
    console.error(`Provider ${provider} error in ${context}:`, error);

    // Classify error type
    const errorType = this.classifyError(error);
    
    // Log error details
    await this.logError(error, provider, context, errorType);

    // Return appropriate error result
    return {
      success: false,
      provider,
      error: this.sanitizeErrorMessage(error.message),
      elapsedMs: 0,
    };
  }

  /**
   * Handle timeout errors
   */
  handleTimeout(provider: ImageProvider, timeoutMs: number): ProviderResult {
    const error = `Provider ${provider} timed out after ${timeoutMs}ms`;
    console.warn(error);

    return {
      success: false,
      provider,
      error,
      elapsedMs: timeoutMs,
    };
  }

  /**
   * Get fallback image result
   */
  getFallbackResult(): ProviderResult {
    return {
      success: false,
      url: this.config.defaults.imageUrl,
      provider: 'default',
      error: 'All providers failed, using fallback image',
      elapsedMs: 0,
    };
  }

  /**
   * Classify error type for better handling
   */
  private classifyError(error: Error): ErrorType {
    if (error instanceof TimeoutError) {
      return 'timeout';
    }
    
    if (error instanceof ImageGenerationError) {
      return 'generation';
    }

    const message = error.message.toLowerCase();
    
    if (message.includes('timeout') || message.includes('timed out')) {
      return 'timeout';
    }
    
    if (message.includes('rate limit') || message.includes('quota')) {
      return 'rate_limit';
    }
    
    if (message.includes('unauthorized') || message.includes('forbidden') || message.includes('api key')) {
      return 'auth';
    }
    
    if (message.includes('network') || message.includes('connection') || message.includes('dns')) {
      return 'network';
    }
    
    if (message.includes('invalid') || message.includes('bad request')) {
      return 'validation';
    }
    
    return 'unknown';
  }

  /**
   * Log error with context
   */
  private async logError(
    error: Error,
    provider: ImageProvider,
    context: string,
    errorType: ErrorType
  ): Promise<void> {
    try {
      // Send to analytics (if available)
      if (this.env.ANALYTICS) {
        await this.env.ANALYTICS.writeDataPoint({
          blobs: [
            this.env.ENVIRONMENT,
            provider,
            'error',
            errorType,
            context,
          ],
          doubles: [Date.now()],
          indexes: [error.message.substring(0, 100)],
        });
      }
    } catch (analyticsError) {
      console.error('Failed to log error to analytics:', analyticsError);
    }
  }

  /**
   * Sanitize error message for client response
   */
  private sanitizeErrorMessage(message: string): string {
    // Remove sensitive information
    const sanitized = message
      .replace(/api[_\s]?key[_\s]?[:\s]*[a-zA-Z0-9_-]+/gi, 'API_KEY_REDACTED')
      .replace(/token[_\s]?[:\s]*[a-zA-Z0-9_-]+/gi, 'TOKEN_REDACTED')
      .replace(/password[_\s]?[:\s]*[^\s]+/gi, 'PASSWORD_REDACTED')
      .replace(/secret[_\s]?[:\s]*[^\s]+/gi, 'SECRET_REDACTED');

    // Truncate if too long
    return sanitized.length > 200 ? sanitized.substring(0, 200) + '...' : sanitized;
  }
}

/**
 * Circuit breaker for provider reliability
 */
export class CircuitBreaker {
  private failures: Map<ImageProvider, FailureTracker> = new Map();
  private config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG) {
    this.config = config;
  }

  /**
   * Check if provider is available (not in open circuit state)
   */
  isProviderAvailable(provider: ImageProvider): boolean {
    const tracker = this.failures.get(provider);
    if (!tracker) {
      return true;
    }

    // If circuit is open, check if enough time has passed to try again
    if (tracker.circuitOpen) {
      const timeSinceLastFailure = Date.now() - tracker.lastFailureTime;
      if (timeSinceLastFailure > this.config.resetTimeoutMs) {
        // Reset circuit to half-open
        tracker.circuitOpen = false;
        tracker.consecutiveFailures = 0;
        return true;
      }
      return false;
    }

    return true;
  }

  /**
   * Record successful operation
   */
  recordSuccess(provider: ImageProvider): void {
    const tracker = this.failures.get(provider);
    if (tracker) {
      tracker.consecutiveFailures = 0;
      tracker.circuitOpen = false;
    }
  }

  /**
   * Record failed operation
   */
  recordFailure(provider: ImageProvider): void {
    let tracker = this.failures.get(provider);
    if (!tracker) {
      tracker = {
        consecutiveFailures: 0,
        lastFailureTime: 0,
        circuitOpen: false,
      };
      this.failures.set(provider, tracker);
    }

    tracker.consecutiveFailures++;
    tracker.lastFailureTime = Date.now();

    // Open circuit if threshold exceeded
    if (tracker.consecutiveFailures >= this.config.failureThreshold) {
      tracker.circuitOpen = true;
      console.warn(`Circuit breaker opened for provider ${provider} after ${tracker.consecutiveFailures} failures`);
    }
  }

  /**
   * Get provider status
   */
  getProviderStatus(provider: ImageProvider): ProviderStatus {
    const tracker = this.failures.get(provider);
    if (!tracker) {
      return { status: 'healthy', consecutiveFailures: 0 };
    }

    if (tracker.circuitOpen) {
      const timeSinceLastFailure = Date.now() - tracker.lastFailureTime;
      if (timeSinceLastFailure > this.config.resetTimeoutMs) {
        return { status: 'half-open', consecutiveFailures: tracker.consecutiveFailures };
      }
      return { status: 'open', consecutiveFailures: tracker.consecutiveFailures };
    }

    return { 
      status: tracker.consecutiveFailures > 0 ? 'degraded' : 'healthy',
      consecutiveFailures: tracker.consecutiveFailures 
    };
  }
}

// Type definitions
type ErrorType = 'timeout' | 'rate_limit' | 'auth' | 'network' | 'validation' | 'generation' | 'unknown';

interface FailureTracker {
  consecutiveFailures: number;
  lastFailureTime: number;
  circuitOpen: boolean;
}

interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
}

interface ProviderStatus {
  status: 'healthy' | 'degraded' | 'open' | 'half-open';
  consecutiveFailures: number;
}

const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 60000, // 1 minute
};

/**
 * Global circuit breaker instance
 */
export const globalCircuitBreaker = new CircuitBreaker();
