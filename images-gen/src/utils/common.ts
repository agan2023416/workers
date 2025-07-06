import { RetryOptions, TimeoutError } from '@/types';

/**
 * Generate unique ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create timeout promise that rejects after specified time
 */
export function createTimeout(ms: number, message = 'Operation timed out'): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new TimeoutError(message, ms)), ms);
  });
}

/**
 * Retry function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { maxRetries, baseDelay, maxDelay, backoffFactor } = options;
  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt === maxRetries) {
        throw lastError;
      }

      const delay = Math.min(
        baseDelay * Math.pow(backoffFactor, attempt),
        maxDelay
      );
      
      await sleep(delay);
    }
  }

  throw lastError!;
}

/**
 * Create abortable promise
 */
export function createAbortablePromise<T>(
  promise: Promise<T>,
  abortController?: AbortController
): Promise<T> & { abort: () => void } {
  let abortFn: () => void;

  const abortablePromise = new Promise<T>((resolve, reject) => {
    const controller = abortController || new AbortController();
    
    abortFn = () => {
      controller.abort();
      reject(new Error('Operation aborted'));
    };

    // Handle abort signal
    if (controller.signal.aborted) {
      reject(new Error('Operation aborted'));
      return;
    }

    controller.signal.addEventListener('abort', () => {
      reject(new Error('Operation aborted'));
    });

    // Execute original promise
    promise.then(resolve, reject);
  }) as Promise<T> & { abort: () => void };

  abortablePromise.abort = abortFn!;
  return abortablePromise;
}

/**
 * Format file size in human readable format
 */
export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Generate R2 object key with date-based path
 */
export function generateR2Key(prefix: string, extension = 'webp'): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const uuid = generateId();
  
  return `${prefix}/${year}/${month}/${uuid}.${extension}`;
}

/**
 * Extract file extension from URL or filename
 */
export function getFileExtension(urlOrFilename: string): string {
  const match = urlOrFilename.match(/\.([^.?#]+)(?:[?#]|$)/);
  return match?.[1]?.toLowerCase() || '';
}

/**
 * Check if string is valid JSON
 */
export function isValidJSON(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

/**
 * Truncate string to specified length
 */
export function truncateString(str: string, maxLength: number, suffix = '...'): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength - suffix.length) + suffix;
}

/**
 * Convert object to URL search params
 */
export function objectToSearchParams(obj: Record<string, any>): URLSearchParams {
  const params = new URLSearchParams();
  
  Object.entries(obj).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      params.append(key, String(value));
    }
  });
  
  return params;
}
