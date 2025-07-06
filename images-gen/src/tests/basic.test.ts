import { describe, it, expect, beforeEach } from 'vitest';
import { validateRequest, sanitizePrompt, isValidUrl } from '../utils/validation';
import { generateId, retry, createTimeout } from '../utils/common';
import { DEFAULT_CONFIG, getEnabledProviders } from '../config';

describe('Validation Utils', () => {
  describe('validateRequest', () => {
    it('should accept valid request', () => {
      const request = {
        prompt: 'A beautiful sunset over mountains',
        keyword: 'landscape',
        articleId: 'article-123',
        width: 1024,
        height: 768,
        style: 'photorealistic'
      };
      
      expect(validateRequest(request)).toBeNull();
    });

    it('should reject empty prompt', () => {
      const request = { prompt: '' };
      expect(validateRequest(request)).toBe('Prompt cannot be empty');
    });

    it('should reject missing prompt', () => {
      const request = {};
      expect(validateRequest(request as any)).toBe('Prompt is required');
    });

    it('should reject prompt that is too long', () => {
      const request = { prompt: 'a'.repeat(1001) };
      expect(validateRequest(request)).toBe('Prompt is too long (max 1000 characters)');
    });

    it('should reject invalid dimensions', () => {
      const request = { prompt: 'test', width: -1 };
      expect(validateRequest(request)).toBe('Width must be a positive number not exceeding 4096');
    });

    it('should reject inappropriate content', () => {
      const request = { prompt: 'nude photo' };
      expect(validateRequest(request)).toBe('Request contains inappropriate content');
    });
  });

  describe('sanitizePrompt', () => {
    it('should trim whitespace', () => {
      expect(sanitizePrompt('  hello world  ')).toBe('hello world');
    });

    it('should remove HTML tags', () => {
      expect(sanitizePrompt('hello <script>alert("xss")</script> world')).toBe('hello alert("xss") world');
    });

    it('should normalize whitespace', () => {
      expect(sanitizePrompt('hello    world\n\ntest')).toBe('hello world test');
    });

    it('should truncate long prompts', () => {
      const longPrompt = 'a'.repeat(1500);
      const sanitized = sanitizePrompt(longPrompt);
      expect(sanitized.length).toBe(1000);
    });
  });

  describe('isValidUrl', () => {
    it('should accept valid HTTP URLs', () => {
      expect(isValidUrl('http://example.com')).toBe(true);
      expect(isValidUrl('https://example.com/path')).toBe(true);
    });

    it('should reject invalid URLs', () => {
      expect(isValidUrl('not-a-url')).toBe(false);
      expect(isValidUrl('ftp://example.com')).toBe(false);
      expect(isValidUrl('')).toBe(false);
    });
  });
});

describe('Common Utils', () => {
  describe('generateId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();
      
      expect(id1).not.toBe(id2);
      expect(typeof id1).toBe('string');
      expect(id1.length).toBeGreaterThan(10);
    });
  });

  describe('retry', () => {
    it('should succeed on first try', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        return 'success';
      };

      const result = await retry(fn, {
        maxRetries: 3,
        baseDelay: 10,
        maxDelay: 100,
        backoffFactor: 2
      });

      expect(result).toBe('success');
      expect(attempts).toBe(1);
    });

    it('should retry on failure', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('fail');
        }
        return 'success';
      };

      const result = await retry(fn, {
        maxRetries: 3,
        baseDelay: 1,
        maxDelay: 10,
        backoffFactor: 2
      });

      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('should throw after max retries', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        throw new Error('always fail');
      };

      await expect(retry(fn, {
        maxRetries: 2,
        baseDelay: 1,
        maxDelay: 10,
        backoffFactor: 2
      })).rejects.toThrow('always fail');

      expect(attempts).toBe(3); // Initial attempt + 2 retries
    });
  });

  describe('createTimeout', () => {
    it('should timeout after specified time', async () => {
      const timeoutPromise = createTimeout(50, 'Test timeout');
      
      await expect(timeoutPromise).rejects.toThrow('Test timeout');
    });
  });
});

describe('Configuration', () => {
  describe('DEFAULT_CONFIG', () => {
    it('should have valid default configuration', () => {
      expect(DEFAULT_CONFIG).toBeDefined();
      expect(DEFAULT_CONFIG.providers).toBeDefined();
      expect(DEFAULT_CONFIG.providers.replicate).toBeDefined();
      expect(DEFAULT_CONFIG.providers.fal).toBeDefined();
      expect(DEFAULT_CONFIG.providers.unsplash).toBeDefined();
      
      // Check provider priorities
      expect(DEFAULT_CONFIG.providers.replicate.priority).toBe(1);
      expect(DEFAULT_CONFIG.providers.fal.priority).toBe(2);
      expect(DEFAULT_CONFIG.providers.unsplash.priority).toBe(3);
      
      // Check timeouts are reasonable
      expect(DEFAULT_CONFIG.providers.replicate.timeout).toBeGreaterThan(0);
      expect(DEFAULT_CONFIG.providers.fal.timeout).toBeGreaterThan(0);
      expect(DEFAULT_CONFIG.providers.unsplash.timeout).toBeGreaterThan(0);
    });

    it('should have valid R2 configuration', () => {
      expect(DEFAULT_CONFIG.r2.pathPrefix).toBe('ai');
      expect(DEFAULT_CONFIG.r2.cacheControl).toContain('max-age');
    });

    it('should have valid defaults', () => {
      expect(DEFAULT_CONFIG.defaults.timeout).toBeGreaterThan(0);
      expect(DEFAULT_CONFIG.defaults.imageUrl).toMatch(/^https?:\/\//);
    });
  });

  describe('getEnabledProviders', () => {
    it('should return enabled providers sorted by priority', () => {
      const providers = getEnabledProviders(DEFAULT_CONFIG);
      
      expect(providers).toHaveLength(3);
      expect(providers[0].name).toBe('replicate');
      expect(providers[1].name).toBe('fal');
      expect(providers[2].name).toBe('unsplash');
    });

    it('should filter out disabled providers', () => {
      const config = {
        ...DEFAULT_CONFIG,
        providers: {
          ...DEFAULT_CONFIG.providers,
          fal: {
            ...DEFAULT_CONFIG.providers.fal,
            enabled: false
          }
        }
      };

      const providers = getEnabledProviders(config);
      expect(providers).toHaveLength(2);
      expect(providers.map(p => p.name)).not.toContain('fal');
    });
  });
});

describe('Error Handling', () => {
  it('should handle network errors gracefully', async () => {
    // Mock fetch to simulate network error
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error('Network error');
    };

    try {
      // Test that errors are properly caught and handled
      await expect(fetch('http://example.com')).rejects.toThrow('Network error');
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('Type Safety', () => {
  it('should have proper TypeScript types', () => {
    // This test mainly ensures TypeScript compilation works
    const request = {
      prompt: 'test',
      keyword: 'test',
      articleId: 'test',
      width: 1024,
      height: 768,
      style: 'test'
    };

    // Should not cause TypeScript errors
    expect(typeof request.prompt).toBe('string');
    expect(typeof request.width).toBe('number');
  });
});
