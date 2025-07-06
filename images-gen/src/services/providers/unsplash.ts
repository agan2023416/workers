import { 
  GenerateImageRequest, 
  ProviderResult, 
  Env, 
  ProviderConfig,
  UnsplashResponse,
  ImageGenerationError 
} from '@/types';
import { createTimeout, retry } from '@/utils/common';
import { validateImageDimensions } from '@/utils/validation';

// Unsplash API configuration
const UNSPLASH_API_BASE = 'https://api.unsplash.com';

/**
 * Generate image using Unsplash API (search for relevant photos)
 */
export async function generateWithUnsplash(
  request: GenerateImageRequest,
  env: Env,
  config: ProviderConfig
): Promise<ProviderResult> {
  if (!env.UNSPLASH_ACCESS_KEY) {
    throw new ImageGenerationError('Unsplash access key not configured', 'unsplash');
  }

  const { width, height } = validateImageDimensions(request.width, request.height);

  try {
    const result = await retry(
      () => searchUnsplashPhoto(request, env, width, height, config),
      {
        maxRetries: config.retries,
        baseDelay: 500,
        maxDelay: 2000,
        backoffFactor: 2,
      }
    );

    return {
      success: true,
      url: result.url,
      provider: 'unsplash',
      elapsedMs: 0, // Will be set by caller
    };
  } catch (error) {
    if (error instanceof ImageGenerationError) {
      throw error;
    }
    
    throw new ImageGenerationError(
      `Unsplash error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'unsplash',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Search for a photo on Unsplash
 */
async function searchUnsplashPhoto(
  request: GenerateImageRequest,
  env: Env,
  width: number,
  height: number,
  config: ProviderConfig
): Promise<{ url: string; attribution?: string }> {
  // Extract keywords from prompt for search
  const searchQuery = extractSearchKeywords(request.prompt, request.keyword);

  const params = new URLSearchParams({
    query: searchQuery,
    per_page: '30', // Get more results for better selection
    orientation: width > height ? 'landscape' : height > width ? 'portrait' : 'squarish',
    content_filter: 'high',
    order_by: 'relevant',
  });

  const response = await Promise.race([
    fetch(`${UNSPLASH_API_BASE}/search/photos?${params}`, {
      headers: {
        'Authorization': `Client-ID ${env.UNSPLASH_ACCESS_KEY}`,
        'Accept-Version': 'v1',
        'Accept': 'application/json',
      },
    }),
    createTimeout(config.timeout, 'Unsplash request timed out'),
  ]);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Unsplash API error: ${response.status} ${errorText}`);
  }

  const searchResult = await response.json();

  if (!searchResult.results || searchResult.results.length === 0) {
    // Fallback to a more generic search
    return await fallbackSearch(env, width, height, config);
  }

  // Select a random photo from the top results
  const randomIndex = Math.floor(Math.random() * Math.min(searchResult.results.length, 10));
  const photo: UnsplashResponse = searchResult.results[randomIndex];

  // Get the appropriate size URL using Unsplash's dynamic resizing
  let imageUrl = photo.urls.regular;

  // Use Unsplash's dynamic resizing for exact dimensions
  const baseUrl = photo.urls.raw;
  imageUrl = `${baseUrl}&w=${width}&h=${height}&fit=crop&crop=entropy&auto=format&q=80`;

  // Track download for Unsplash API requirements
  await trackDownload(photo.id || '', env);

  return {
    url: imageUrl,
    attribution: `Photo by ${photo.user.name} (@${photo.user.username}) on Unsplash`,
  };
}

/**
 * Fallback search with generic terms
 */
async function fallbackSearch(
  env: Env,
  width: number,
  height: number,
  config: ProviderConfig
): Promise<{ url: string; attribution?: string }> {
  const fallbackQueries = [
    'abstract',
    'nature',
    'landscape',
    'minimal',
    'background',
    'texture',
    'pattern',
  ];

  const randomQuery = fallbackQueries[Math.floor(Math.random() * fallbackQueries.length)];

  const params = new URLSearchParams();
  if (randomQuery) {
    params.append('query', randomQuery);
  }
  params.append('per_page', '10');
  params.append('orientation', width > height ? 'landscape' : height > width ? 'portrait' : 'squarish');
  params.append('content_filter', 'high');
  params.append('order_by', 'popular');

  const response = await Promise.race([
    fetch(`${UNSPLASH_API_BASE}/search/photos?${params}`, {
      headers: {
        'Authorization': `Client-ID ${env.UNSPLASH_ACCESS_KEY}`,
        'Accept-Version': 'v1',
      },
    }),
    createTimeout(config.timeout, 'Unsplash fallback request timed out'),
  ]);

  if (!response.ok) {
    throw new Error(`Unsplash fallback search failed: ${response.status}`);
  }

  const searchResult = await response.json();

  if (!searchResult.results || searchResult.results.length === 0) {
    throw new Error('No fallback images found on Unsplash');
  }

  const photo: UnsplashResponse = searchResult.results[0];

  // Use Unsplash's dynamic resizing for exact dimensions
  const baseUrl = photo.urls.raw;
  const imageUrl = `${baseUrl}&w=${width}&h=${height}&fit=crop&crop=entropy&auto=format&q=80`;

  await trackDownload(photo.id || '', env);

  return {
    url: imageUrl,
    attribution: `Photo by ${photo.user.name} (@${photo.user.username}) on Unsplash`,
  };
}

/**
 * Extract search keywords from prompt
 */
function extractSearchKeywords(prompt: string, keyword?: string): string {
  // If keyword is provided, use it
  if (keyword && keyword.trim()) {
    return keyword.trim();
  }

  // Extract meaningful words from prompt
  const words = prompt
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2)
    .filter(word => !['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'two', 'who', 'boy', 'did', 'she', 'use', 'way', 'will', 'with'].includes(word));

  // Take first few meaningful words
  return words.slice(0, 3).join(' ') || 'abstract';
}

/**
 * Track photo download for Unsplash API compliance
 */
async function trackDownload(photoId: string, env: Env): Promise<void> {
  if (!photoId) return;

  try {
    await fetch(`${UNSPLASH_API_BASE}/photos/${photoId}/download`, {
      headers: {
        'Authorization': `Client-ID ${env.UNSPLASH_ACCESS_KEY}`,
        'Accept-Version': 'v1',
      },
    });
  } catch (error) {
    console.error('Failed to track Unsplash download:', error);
  }
}

/**
 * Validate Unsplash access key
 */
export async function validateUnsplashKey(accessKey: string): Promise<boolean> {
  try {
    const response = await fetch(`${UNSPLASH_API_BASE}/me`, {
      headers: {
        'Authorization': `Client-ID ${accessKey}`,
        'Accept-Version': 'v1',
      },
    });

    return response.ok;
  } catch {
    return false;
  }
}
