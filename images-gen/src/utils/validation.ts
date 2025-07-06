import { GenerateImageRequest } from '@/types';

/**
 * Validate image generation request
 */
export function validateRequest(request: GenerateImageRequest): string | null {
  // Check required fields
  if (!request.prompt) {
    return 'Prompt is required';
  }

  if (typeof request.prompt !== 'string') {
    return 'Prompt must be a string';
  }

  if (request.prompt.trim().length === 0) {
    return 'Prompt cannot be empty';
  }

  if (request.prompt.length > 1000) {
    return 'Prompt is too long (max 1000 characters)';
  }

  // Validate optional fields
  if (request.keyword !== undefined) {
    if (typeof request.keyword !== 'string') {
      return 'Keyword must be a string';
    }
    if (request.keyword.length > 100) {
      return 'Keyword is too long (max 100 characters)';
    }
  }

  if (request.articleId !== undefined) {
    if (typeof request.articleId !== 'string') {
      return 'ArticleId must be a string';
    }
    if (request.articleId.length > 50) {
      return 'ArticleId is too long (max 50 characters)';
    }
  }

  if (request.width !== undefined) {
    if (typeof request.width !== 'number' || request.width <= 0 || request.width > 4096) {
      return 'Width must be a positive number not exceeding 4096';
    }
  }

  if (request.height !== undefined) {
    if (typeof request.height !== 'number' || request.height <= 0 || request.height > 4096) {
      return 'Height must be a positive number not exceeding 4096';
    }
  }

  if (request.style !== undefined) {
    if (typeof request.style !== 'string') {
      return 'Style must be a string';
    }
    if (request.style.length > 100) {
      return 'Style is too long (max 100 characters)';
    }
  }

  // Check for potentially harmful content
  const harmfulPatterns = [
    /\b(nude|naked|sex|porn|explicit)\b/i,
    /\b(violence|blood|gore|death)\b/i,
    /\b(hate|racist|nazi|terrorist)\b/i,
  ];

  const fullText = `${request.prompt} ${request.keyword || ''} ${request.style || ''}`;
  for (const pattern of harmfulPatterns) {
    if (pattern.test(fullText)) {
      return 'Request contains inappropriate content';
    }
  }

  return null;
}

/**
 * Sanitize prompt for safe processing
 */
export function sanitizePrompt(prompt: string): string {
  return prompt
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .replace(/\s+/g, ' ') // Normalize whitespace
    .substring(0, 1000); // Ensure max length
}

/**
 * Validate URL format
 */
export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validate image dimensions
 */
export function validateImageDimensions(width?: number, height?: number): { width: number; height: number } {
  const defaultWidth = 1024;
  const defaultHeight = 768;
  const maxDimension = 4096;
  const minDimension = 64;

  const validWidth = width && width >= minDimension && width <= maxDimension ? width : defaultWidth;
  const validHeight = height && height >= minDimension && height <= maxDimension ? height : defaultHeight;

  return { width: validWidth, height: validHeight };
}
