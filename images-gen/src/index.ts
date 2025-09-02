// No imports for now - inline everything (including unified processor)

// Define types inline to avoid import issues
interface Env {
  IMAGES_BUCKET: R2Bucket;
  STATE_KV: KVNamespace;
  CONFIG_KV: KVNamespace;
  ANALYTICS?: AnalyticsEngineDataset;
  ENVIRONMENT: string;
  REPLICATE_API_TOKEN?: string;
  FAL_KEY?: string;
  UNSPLASH_ACCESS_KEY?: string;
  API_KEY?: string;
  R2_CUSTOM_DOMAIN?: string;
  WEBHOOK_SECRET?: string;
}

interface GenerateImageRequest {
  // 新增：原文图片URL（可选）
  imageUrl?: string;
  // 原有：AI生成提示词（当imageUrl无效时必需）
  prompt?: string;
  provider?: string;
  articleId?: string;
}

const DEFAULT_FALLBACK_IMAGE = 'https://via.placeholder.com/1024x768/4A90E2/FFFFFF?text=Default+Image';

interface GenerateImageResponse {
  url: string;
  provider: string;
  elapsedMs: number;
  success: boolean;
  error?: string;
  r2Stored?: boolean;
  r2Error?: string;
  taskId?: string;
}

// Inline response functions
function createSuccessResponse<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Cache-Control': 'no-cache',
    },
  });
}

// Crypto helpers for webhook signature verification
async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const bytes = new Uint8Array(sig);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function createErrorResponse(message: string, status = 400): Response {
  return new Response(
    JSON.stringify({
      error: message,
      timestamp: new Date().toISOString(),
    }),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Cache-Control': 'no-cache',
      },
    }
  );
}

// Authentication function
function authenticateRequest(request: Request, env: Env): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return false;

  const token = authHeader.replace('Bearer ', '');
  return token === env.API_KEY;
}

/**
 * Simplified Worker for debugging
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    try {
      console.log(`${request.method} ${request.url}`);

      // Handle CORS preflight
      if (request.method === 'OPTIONS') {
        console.log('Handling CORS preflight');
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Max-Age': '86400',
          },
        });
      }

      // Route handling
      const url = new URL(request.url);
      const path = url.pathname;
      console.log(`Routing to path: ${path}`);

      // Authentication: allow public access for health check, R2 image read-only endpoint, webhook, and status query
      const isPublicEndpoint =
        path === '/health' ||
        (path === '/images/r2' && request.method === 'GET') ||
        (path === '/replicate/webhook' && request.method === 'POST') ||
        ((path === '/images/result' || path === '/status') && request.method === 'GET');
      if (!isPublicEndpoint) {
        if (!authenticateRequest(request, env)) {
          console.log('Authentication failed');
          return createErrorResponse('Unauthorized - API key required', 401);
        }
        console.log('Authentication successful');
      }

      switch (path) {
        case '/health':
          console.log('Handling health check');
          return createSuccessResponse({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            version: '1.0.0',
            secrets: {
              replicate: !!env.REPLICATE_API_TOKEN,
              fal: !!env.FAL_KEY,
              unsplash: !!env.UNSPLASH_ACCESS_KEY,
              api: !!env.API_KEY,
            }
          });

        case '/test-r2':
          console.log('Testing R2 storage functionality');
          if (request.method !== 'POST') {
            return createErrorResponse('Method Not Allowed', 405);
          }

          try {
            const body = await request.json() as { imageUrl: string; articleId?: string };

            if (!body.imageUrl) {
              return createErrorResponse('Missing imageUrl', 400);
            }

            const url = await storeImageInR2(body.imageUrl, body.articleId, env, new URL(request.url).origin);

            return createSuccessResponse({
              status: 'r2-test-success',
              message: 'Image stored successfully in R2',
              articleId: body.articleId,
              imageUrl: body.imageUrl,
              r2Url: url,
            });
          } catch (error) {
            return createErrorResponse(
              error instanceof Error ? error.message : 'R2 test failed',
              500
            );
          }

        case '/test-replicate':
          console.log('Testing Replicate API connection');
          if (request.method !== 'GET') {
            return createErrorResponse('Method Not Allowed', 405);
          }

          try {
            if (!env.REPLICATE_API_TOKEN) {
              return createErrorResponse('REPLICATE_API_TOKEN not configured', 500);
            }

            // Test Replicate API connection
            const testResponse = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-schnell', {
              headers: {
                'Authorization': `Token ${env.REPLICATE_API_TOKEN}`,
              },
            });

            const testData = await testResponse.json();

            return createSuccessResponse({
              status: 'replicate-test',
              apiStatus: testResponse.status,
              apiOk: testResponse.ok,
              latestVersion: testData.latest_version?.id || 'not found',
              modelData: testData,
            });
          } catch (error) {
            return createErrorResponse(
              error instanceof Error ? error.message : 'Replicate test failed',
              500
            );
          }

        case '/replicate/webhook':
          // Replicate webhook callback (POST)
          if (request.method !== 'POST') {
            return createErrorResponse('Method Not Allowed', 405);
          }
          try {
            const rawBody = await request.text();
            const signature = request.headers.get('X-Replicate-Signature');
            if (env.WEBHOOK_SECRET) {
              if (!signature) {
                return createErrorResponse('Missing signature', 401);
              }
              const computed = await hmacSha256Hex(env.WEBHOOK_SECRET, rawBody);
              if (!safeEqual(signature, computed)) {
                console.warn('Invalid webhook signature');
                return createErrorResponse('Invalid signature', 401);
              }
            }

            const payload = JSON.parse(rawBody);
            // Basic validation
            const predictionId = payload?.id || payload?.prediction?.id;
            const status = payload?.status;
            const output = payload?.output;
            console.log('Webhook received:', { predictionId, status });

            if (!predictionId) {
              return createErrorResponse('Invalid webhook payload', 400);
            }

            // Load context from KV
            const ctxRaw = await env.STATE_KV.get(`replicate:ctx:${predictionId}`);
            if (!ctxRaw) {
              console.warn('Context not found in KV for prediction:', predictionId);
              // Still record status for visibility
              await env.STATE_KV.put(`replicate:result:${predictionId}`,
                JSON.stringify({ status, note: 'no-ctx' }), { expirationTtl: 60 * 60 });
              return createSuccessResponse({ ok: true, message: 'No context found' });
            }
            const ctx = JSON.parse(ctxRaw) as { articleId?: string; baseUrl: string };

            if (status === 'succeeded' && Array.isArray(output) && output.length > 0) {
              const imageUrl = output[0];
              try {
                const r2Url = await storeImageInR2(imageUrl, ctx.articleId, env, ctx.baseUrl);
                await env.STATE_KV.put(`replicate:result:${predictionId}`, JSON.stringify({ url: r2Url, status: 'succeeded' }), { expirationTtl: 60 * 60 });
                console.log('Webhook stored image to R2:', r2Url);
                return createSuccessResponse({ ok: true });
              } catch (e) {
                await env.STATE_KV.put(`replicate:result:${predictionId}`, JSON.stringify({ error: String(e), status: 'failed' }), { expirationTtl: 60 * 60 });
                return createErrorResponse('Failed to store image to R2', 500);
              }
            } else if (status === 'failed' || status === 'canceled') {
              await env.STATE_KV.put(`replicate:result:${predictionId}`, JSON.stringify({ status }), { expirationTtl: 60 * 60 });
              return createSuccessResponse({ ok: true });
            }

            // If still processing, just acknowledge
            await env.STATE_KV.put(`replicate:result:${predictionId}`, JSON.stringify({ status: status || 'processing' }), { expirationTtl: 60 * 60 });
            return createSuccessResponse({ ok: true });
          } catch (e) {
            console.error('Webhook error:', e);
            return createErrorResponse('Webhook handling failed', 500);
          }

        case '/images/generate':
          console.log('Handling unified image generation request');
          if (request.method !== 'POST') {
            return createErrorResponse('Method Not Allowed', 405);
          }

          try {
            const body = await request.json() as GenerateImageRequest;
            console.log('Request body:', body);

            // 检查是否使用新的统一处理逻辑
            const useUnifiedProcessor = body.imageUrl ||
              (body.prompt && body.imageUrl === undefined); // 明确支持新接口

            if (useUnifiedProcessor) {
              console.log('Using unified image processor');

              // 使用新的统一图片处理服务
              const unifiedResult = await processUnifiedImageRequest(
                body,
                env,
                getDefaultConfig(),
                new URL(request.url).origin
              );

              // 转换为兼容的响应格式
              const compatibleResult = {
                url: unifiedResult.url,
                provider: mapSourceToProvider(unifiedResult.source),
                elapsedMs: unifiedResult.elapsedMs,
                success: unifiedResult.success,
                error: unifiedResult.error,
                r2Stored: unifiedResult.r2Stored,
                r2Error: unifiedResult.details?.r2StorageError,
                // 新增字段
                source: unifiedResult.source,
                originalUrl: unifiedResult.originalUrl,
                usedPrompt: unifiedResult.usedPrompt
              };

              console.log('Unified processing result:', compatibleResult);
              return createSuccessResponse(compatibleResult);
            }

            // 保持原有逻辑用于向后兼容
            console.log('Using legacy image generation logic');
            const result = await generateImage(body, env, new URL(request.url).origin);

            // If Replicate was chosen or defaulted but time budget is tight, return taskId for async completion
            if (!result.success && (body.provider === 'replicate' || !body.provider)) {
              // try to parse a pending taskId from result if provided later
            }

            // Default debug fields
            (result as any).r2Stored = false;
            (result as any).r2Error = undefined;

            // Attempt to store in R2 if generation succeeded (articleId optional)
            if (result.success) {
              const maxRetries = 2; // total attempts = 1 + retries = 3
              let attempt = 0;
              let lastError: any = null;
              let r2Url: string | null = null;

              while (attempt <= maxRetries) {
                try {
                  const baseUrl = new URL(request.url).origin;
                  r2Url = await storeImageInR2(result.url, body.articleId, env, baseUrl);
                  console.log('Image stored in R2', body.articleId ? `for article: ${body.articleId}` : '(no articleId)');
                  console.log('R2 URL:', r2Url);
                  (result as any).url = r2Url; // overwrite with permanent URL
                  (result as any).r2Stored = true;
                  (result as any).r2Error = undefined;
                  break;
                } catch (r2Error) {
                  lastError = r2Error;
                  (result as any).r2Stored = false;
                  (result as any).r2Error = r2Error instanceof Error ? r2Error.message : 'R2 storage failed';
                  console.error(`Failed to store in R2 (attempt ${attempt + 1}/${maxRetries + 1}):`, r2Error);

                  // Simple backoff before retrying (except after last attempt)
                  if (attempt < maxRetries) {
                    const backoff = 300 * Math.pow(2, attempt); // 300ms, 600ms, 1200ms
                    await new Promise((res) => setTimeout(res, backoff));
                  }

                  attempt++;
                }
              }

              // If R2 upload failed, fall back to generating an Unsplash image and upload that to R2
              if (!(result as any).r2Stored) {
                try {
                  console.warn('Primary R2 upload failed; falling back to Unsplash image and re-uploading to R2');
                  const unsplash = await generateWithUnsplash(body, env, Date.now());
                  if (!unsplash.success || !unsplash.url) {
                    throw new Error(unsplash.error || 'Unsplash fallback generation failed');
                  }
                  const baseUrl = new URL(request.url).origin;
                  const fallbackR2Url = await storeImageInR2(unsplash.url, body.articleId, env, baseUrl);
                  (result as any).url = fallbackR2Url;
                  (result as any).provider = unsplash.provider;
                  (result as any).r2Stored = true;
                  (result as any).r2Error = undefined;
                } catch (fallbackErr) {
                  const message = `R2 upload failed and Unsplash fallback upload also failed: ${fallbackErr instanceof Error ? fallbackErr.message : 'Unknown error'}`;
                  console.error(message);
                  return createErrorResponse(message, 502);
                }
              }
            }


            console.log('Returning response:', result);
            return createSuccessResponse(result);
          } catch (error) {
            console.error('Error in image generation:', error);
            return createErrorResponse(
              error instanceof Error ? error.message : 'Image generation failed',
              500
            );
          }

        case '/images/r2':
          console.log('Handling R2 image access request');
          if (request.method !== 'GET') {
            return createErrorResponse('Method Not Allowed', 405);
          }

          try {
            const url = new URL(request.url);
            const key = url.searchParams.get('key');

            if (!key) {
              return createErrorResponse('Missing key parameter', 400);
            }

            console.log('Fetching image from R2 with key:', key);

            const object = await env.IMAGES_BUCKET.get(key);

            if (!object) {
              return createErrorResponse('Image not found', 404);
            }

            const headers = new Headers();
            headers.set('Content-Type', object.httpMetadata?.contentType || 'image/jpeg');
            headers.set('Cache-Control', 'public, max-age=31536000'); // 1 year cache
            headers.set('Access-Control-Allow-Origin', '*');

            return new Response(object.body, {
              headers,
              status: 200,
            });
          } catch (error) {
            console.error('Error serving R2 image:', error);
            return createErrorResponse(
              error instanceof Error ? error.message : 'Failed to serve image',
              500
            );
          }

        case '/images/result':
          // Public status/result endpoint for async tasks
          if (request.method !== 'GET') {
            return createErrorResponse('Method Not Allowed', 405);
          }
          try {
            const urlObj = new URL(request.url);
            const taskId = urlObj.searchParams.get('taskId');
            if (!taskId) return createErrorResponse('Missing taskId', 400);

            const resultRaw = await env.STATE_KV.get(`replicate:result:${taskId}`);
            if (!resultRaw) {
              return createSuccessResponse({ status: 'pending' });
            }
            const result = JSON.parse(resultRaw);
            return createSuccessResponse(result);
          } catch (e) {
            console.error('Error in /images/result:', e);
            return createErrorResponse('Failed to fetch result', 500);
          }

        case '/status':
          // Simple alias to query by taskId; supports provider expansion later
          if (request.method !== 'GET') {
            return createErrorResponse('Method Not Allowed', 405);
          }
          try {
            const urlObj = new URL(request.url);
            const taskId = urlObj.searchParams.get('taskId');
            if (!taskId) return createErrorResponse('Missing taskId', 400);
            const resultRaw = await env.STATE_KV.get(`replicate:result:${taskId}`);
            if (!resultRaw) return createSuccessResponse({ status: 'pending' });
            return createSuccessResponse(JSON.parse(resultRaw));
          } catch (e) {
            console.error('Error in /status:', e);
            return createErrorResponse('Failed to fetch status', 500);
          }

        default:
          return createErrorResponse('Not Found', 404);
      }
    } catch (error) {
      console.error('Unhandled error:', error);

      return createErrorResponse(
        error instanceof Error ? error.message : 'Unknown error',
        500
      );
    }
  },
};

// Image generation function with priority racing
async function generateImage(request: GenerateImageRequest, env: Env, baseUrl: string) {
  const startTime = Date.now();

  // If specific provider is requested, use it directly
  if (request.provider) {
    console.log(`Generating image with specific provider: ${request.provider}`);

    switch (request.provider) {
      case 'replicate':
        return await generateWithReplicate(request, env, startTime, baseUrl);
      case 'fal':
        return await generateWithFal(request, env, startTime);
      case 'unsplash':
        return await generateWithUnsplash(request, env, startTime);
      default:
        return await generateWithUnsplash(request, env, startTime);
    }
  }

  // Priority racing: Replicate → Fal → Unsplash (with proper timeouts)
  console.log('Starting priority racing: Replicate → Fal → Unsplash');

  // Step 1: Try Replicate first (90 seconds timeout - maximum priority for best quality)
  try {
    console.log('Priority racing: Trying Replicate AI (90s timeout - MAXIMUM PRIORITY)...');
    const replicateResult = await Promise.race([
      generateWithReplicate(request, env, startTime, baseUrl),
      new Promise<GenerateImageResponse>((_, reject) =>
        setTimeout(() => reject(new Error('Replicate timeout after 25s')), 25000)
      )
    ]);

    console.log('Replicate result in priority racing:', replicateResult);

    if (replicateResult.success) {
      console.log('Priority racing: Replicate AI succeeded');
      return replicateResult;
    } else {
      console.log('Priority racing: Replicate AI failed, trying next provider. Error:', replicateResult.error);
    }
  } catch (error) {
    console.log('Priority racing: Replicate AI failed or timed out:', error);
  }

  // Step 2: Try Fal AI second (30 seconds timeout - secondary priority)
  try {
    console.log('Priority racing: Trying Fal AI (30s timeout - secondary priority)...');
    const falResult = await Promise.race([
      generateWithFal(request, env, startTime),
      new Promise<GenerateImageResponse>((_, reject) =>
        setTimeout(() => reject(new Error('Fal timeout after 12s')), 12000)
      )
    ]);

    if (falResult.success) {
      console.log('Fal AI succeeded');
      return falResult;
    } else {
      console.log('Fal AI failed, trying next provider');
    }
  } catch (error) {
    console.log('Fal AI failed or timed out:', error);
  }

  // Step 3: Final fallback to Unsplash (only when both AI providers fail)
  console.log('Both AI providers failed, falling back to Unsplash as last resort...');
  try {
    const unsplashResult = await generateWithUnsplash(request, env, startTime);
    console.log('Unsplash fallback succeeded');
    return unsplashResult;
  } catch (error) {
    console.error('All providers including Unsplash failed:', error);

    // Final emergency fallback
    return {
      url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1024&h=768&fit=crop&auto=format',
      provider: 'emergency-fallback',
      elapsedMs: Date.now() - startTime,
      success: false,
      error: 'All providers failed including Unsplash',
    };
  }
}

// Unsplash provider (real API call)
async function generateWithUnsplash(request: GenerateImageRequest, env: Env, startTime: number) {
  console.log('Generating with Unsplash API');

  try {
    // Use Unsplash API to search for images
    const searchQuery = encodeURIComponent(request.prompt);
    const unsplashUrl = `https://api.unsplash.com/search/photos?query=${searchQuery}&per_page=10&orientation=landscape`;

    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    // Add authorization if available
    if (env.UNSPLASH_ACCESS_KEY) {
      headers['Authorization'] = `Client-ID ${env.UNSPLASH_ACCESS_KEY}`;
    }

    console.log('Calling Unsplash API:', unsplashUrl);

    const response = await fetch(unsplashUrl, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      console.error('Unsplash API error:', response.status, response.statusText);
      throw new Error(`Unsplash API error: ${response.status}`);
    }

    const data = await response.json() as any;
    console.log('Unsplash API response:', data);

    if (!data.results || data.results.length === 0) {
      console.log('No images found, using fallback');
      // Fallback to a default image
      return {
        url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1024&h=768&fit=crop&auto=format',
        provider: 'unsplash-fallback',
        elapsedMs: Date.now() - startTime,
        success: true,
        error: undefined,
      };
    }

    // Pick a random image from results
    const randomIndex = Math.floor(Math.random() * data.results.length);
    const selectedImage = data.results[randomIndex];

    // Use the regular size with proper parameters (preserve existing query params)
    const u = new URL(selectedImage.urls.regular);
    u.searchParams.set('w', '1024');
    u.searchParams.set('h', '768');
    u.searchParams.set('fit', 'crop');
    u.searchParams.set('auto', 'format');
    const imageUrl = u.toString();

    console.log('Selected Unsplash image:', imageUrl);

    return {
      url: imageUrl,
      provider: 'unsplash',
      elapsedMs: Date.now() - startTime,
      success: true,
      error: undefined,
    };
  } catch (error) {
    console.error('Unsplash generation failed:', error);

    // Return fallback image
    return {
      url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1024&h=768&fit=crop&auto=format',
      provider: 'unsplash-fallback',
      elapsedMs: Date.now() - startTime,
      success: false,
      error: error instanceof Error ? error.message : 'Unsplash API failed',
    };
  }
}

// Fal provider (real API call)
async function generateWithFal(request: GenerateImageRequest, env: Env, startTime: number) {
  console.log('Generating with Fal AI');
  console.log('FAL_KEY available:', !!env.FAL_KEY);

  try {
    if (!env.FAL_KEY) {
      console.log('FAL_KEY not found in environment');
      throw new Error('FAL_KEY not configured');
    }

    console.log('FAL_KEY found, proceeding with API call');

    // Use FLUX.1 [schnell] model for fast generation
    const payload = {
      prompt: request.prompt,
      image_size: 'landscape_4_3',
      num_inference_steps: 4, // FLUX schnell 推荐 4 步
      num_images: 1,
      enable_safety_checker: true,
      seed: Math.floor(Math.random() * 1000000), // 随机种子确保多样性
    };

    console.log('Calling Fal AI API with payload:', payload);

    const response = await fetch('https://fal.run/fal-ai/flux/schnell', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${env.FAL_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    console.log('Fal AI response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Fal AI API error:', response.status, response.statusText, errorText);
      throw new Error(`Fal AI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as any;
    console.log('Fal AI API response data:', JSON.stringify(data, null, 2));

    if (!data.images || data.images.length === 0) {
      console.error('No images in Fal AI response');
      throw new Error('No images generated by Fal AI');
    }

    // Get the first generated image
    const imageUrl = data.images[0].url;
    console.log('Generated Fal AI image URL:', imageUrl);

    return {
      url: imageUrl,
      provider: 'fal',
      elapsedMs: Date.now() - startTime,
      success: true,
      error: undefined,
    };
  } catch (error) {
    console.error('Fal AI generation failed:', error);

    // Return fallback image
    return {
      url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1024&h=768&fit=crop&auto=format',
      provider: 'fal-fallback',
      elapsedMs: Date.now() - startTime,
      success: false,
      error: error instanceof Error ? error.message : 'Fal AI failed',
    };
  }
}

// Replicate provider (real API call)
async function generateWithReplicate(request: GenerateImageRequest, env: Env, startTime: number, baseUrl?: string) {
  console.log('Generating with Replicate AI');
  console.log('REPLICATE_API_TOKEN available:', !!env.REPLICATE_API_TOKEN);

  try {
    if (!env.REPLICATE_API_TOKEN) {
      console.log('REPLICATE_API_TOKEN not found in environment');
      throw new Error('REPLICATE_API_TOKEN not configured');
    }

    console.log('REPLICATE_API_TOKEN found, proceeding with API call');

    // Use FLUX.1 [schnell] model for fast generation
    const model = "black-forest-labs/flux-schnell";

    const input = {
      prompt: request.prompt,
      go_fast: true, // 启用快速模式
      num_outputs: 1,
      aspect_ratio: "4:3", // 设置宽高比
      output_format: "webp", // 使用 WebP 格式减少传输时间
      output_quality: 90, // 高质量输出
    };

    console.log('Calling Replicate API with input:', input);

    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${env.REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: "c846a69991daf4c0e5d016514849d14ee5b2e6846ce6b9d6f21369e564cfe51e",
        input: input,
        webhook: `${baseUrl ?? ''}/replicate/webhook`,
        webhook_events_filter: ["completed"],
      }),
    });

    console.log('Replicate response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Replicate API error details:');
      console.error('Status:', response.status);
      console.error('Status Text:', response.statusText);
      console.error('Response Body:', errorText);
      console.error('Request Body was:', JSON.stringify({ model: model, input: input }));
      throw new Error(`Replicate API error: ${response.status} - ${errorText}`);
    }

    const prediction = await response.json() as any;
    console.log('Replicate prediction created:', prediction.id);

    // Store context for webhook consumption
    try {
      await env.STATE_KV.put(
        `replicate:ctx:${prediction.id}`,
        JSON.stringify({ articleId: request.articleId, baseUrl: baseUrl ?? '' }),
        { expirationTtl: 24 * 60 * 60 }
      );
    } catch (e) {
      console.warn('Failed to write replicate:ctx to KV:', e);
    }

    // Wait for the prediction to complete within our time budget
    let finalPrediction = prediction;
    const maxWaitTime = 22000; // <= 外层 25s 预算内
    const pollInterval = 2000; // 2s
    const maxPolls = Math.floor(maxWaitTime / pollInterval);

    for (let i = 0; i < maxPolls; i++) {
      if (finalPrediction.status === 'succeeded') {
        break;
      }

      if (finalPrediction.status === 'failed' || finalPrediction.status === 'canceled') {
        throw new Error(`Replicate prediction failed: ${finalPrediction.error || 'Unknown error'}`);
      }

      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      // Poll for status
      const statusResponse = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
        headers: {
          'Authorization': `Token ${env.REPLICATE_API_TOKEN}`,
        },
      });

      if (statusResponse.ok) {
        finalPrediction = await statusResponse.json();
        console.log(`Replicate status poll ${i + 1}: ${finalPrediction.status}`);
      }
    }

    if (finalPrediction.status !== 'succeeded') {
      // Timed out within our budget - return taskId for async completion
      return {
        url: `${baseUrl ?? ''}/images/result?taskId=${prediction.id}`,
        provider: 'replicate',
        elapsedMs: Date.now() - startTime,
        success: false,
        error: `Prediction pending: ${finalPrediction.status}`,
        taskId: prediction.id,
      } as GenerateImageResponse;
    }

    if (!finalPrediction.output || finalPrediction.output.length === 0) {
      console.error('No images in Replicate response');
      throw new Error('No images generated by Replicate');
    }

    // Get the first generated image URL
    const imageUrl = finalPrediction.output[0];
    console.log('Generated Replicate image URL:', imageUrl);

    return {
      url: imageUrl,
      provider: 'replicate',
      elapsedMs: Date.now() - startTime,
      success: true,
      error: undefined,
      taskId: prediction.id,
    } as GenerateImageResponse;
  } catch (error) {
    console.error('Replicate generation failed:', error);

    // Return fallback image
    return {
      url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1024&h=768&fit=crop&auto=format',
      provider: 'replicate-fallback',
      elapsedMs: Date.now() - startTime,
      success: false,
      error: error instanceof Error ? error.message : 'Replicate failed',
    } as GenerateImageResponse;
  }
}

// R2 Storage function
async function storeImageInR2(imageUrl: string, articleId: string | undefined, env: Env, baseUrl: string): Promise<string> {
  console.log('Storing image in R2:', imageUrl, articleId ? `for article: ${articleId}` : '(no articleId)');

  try {
    // Download the image
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to download image: ${imageResponse.status}`);
    }

    const imageBlob = await imageResponse.blob();
    const imageBuffer = await imageBlob.arrayBuffer();
    const contentType = imageBlob.type || 'image/jpeg';

    // Infer file extension from content type
    const typeMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/svg+xml': 'svg',
      'image/bmp': 'bmp',
      'image/tiff': 'tiff',
    };
    const extension = typeMap[contentType.toLowerCase()] || 'jpg';

    // Generate a unique key for the image
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    const random = Math.random().toString(36).slice(2, 8);

    const key = articleId
      ? `articles/${articleId}/images/${timestamp}.${extension}`
      : `ai/${year}/${month}/${timestamp}-${random}.${extension}`;

    // Store in R2
    await env.IMAGES_BUCKET.put(key, imageBuffer, {
      httpMetadata: {
        contentType,
        cacheControl: 'public, max-age=31536000, immutable', // 1 year, immutable
      },
      customMetadata: {
        ...(articleId ? { articleId } : {}),
        originalUrl: imageUrl,
        storedAt: new Date().toISOString(),
      },
    });

    console.log('Image successfully stored in R2 with key:', key);

    // Optionally store metadata in KV
    const metadata = {
      key,
      originalUrl: imageUrl,
      storedAt: new Date().toISOString(),
      contentType,
      size: imageBuffer.byteLength,
    };

    const metaKey = articleId ? `image:${articleId}:${timestamp}` : `image:public:${timestamp}`;
    await env.STATE_KV.put(metaKey, JSON.stringify(metadata));
    console.log('Image metadata stored in KV');

    // Return the accessible CDN URL if custom domain configured; otherwise fallback to Worker proxy endpoint
    if (env.R2_CUSTOM_DOMAIN) {
      const cdnUrl = `https://${env.R2_CUSTOM_DOMAIN}/${key}`;
      console.log('Image accessible at (CDN):', cdnUrl);
      return cdnUrl;
    }

    // Fallback to current request origin for proxy URL
    const accessUrl = `${baseUrl}/images/r2?key=${encodeURIComponent(key)}`;
    console.log('Image accessible at (worker proxy):', accessUrl);
    return accessUrl;

  } catch (error) {
    console.error('Error storing image in R2:', error);
    throw error;
  }
}

// 辅助函数：获取默认配置
function getDefaultConfig() {
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
      imageUrl: DEFAULT_FALLBACK_IMAGE
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

// 辅助函数：将source映射到provider（向后兼容）
function mapSourceToProvider(source: string): string {
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

// 统一图片处理函数（增强版本）
async function processUnifiedImageRequest(
  request: GenerateImageRequest,
  env: Env,
  config: any,
  baseUrl: string
): Promise<any> {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const logger = new UnifiedImageLogger(env, requestId);

  logger.logStep('request_received', 'success', {
    imageUrl: request.imageUrl ? '[PROVIDED]' : '[NOT_PROVIDED]',
    prompt: request.prompt ? '[PROVIDED]' : '[NOT_PROVIDED]',
    articleId: request.articleId,
    provider: request.provider
  });

  try {
    // 参数验证
    logger.logStep('parameter_validation', 'success', null, 'Starting parameter validation');

    if (!request.imageUrl && !request.prompt) {
      const error = UnifiedImageError.configurationError(
        'Either imageUrl or prompt must be provided',
        { imageUrl: !!request.imageUrl, prompt: !!request.prompt }
      );
      logger.logStep('parameter_validation', 'failure', error.details, error.message);
      throw error;
    }

    if (request.imageUrl) {
      try {
        new URL(request.imageUrl);
        logger.logStep('parameter_validation', 'success', { imageUrl: 'valid_format' });
      } catch {
        const error = UnifiedImageError.urlValidationError(
          'Invalid imageUrl format',
          { imageUrl: request.imageUrl }
        );
        logger.logStep('parameter_validation', 'failure', error.details, error.message);
        throw error;
      }
    }

    if (request.prompt && request.prompt.trim().length === 0) {
      const error = UnifiedImageError.configurationError(
        'Prompt cannot be empty',
        { prompt: request.prompt }
      );
      logger.logStep('parameter_validation', 'failure', error.details, error.message);
      throw error;
    }

    logger.logStep('parameter_validation', 'success', null, 'All parameters validated successfully');

    let result: any;

    // 处理流程：优先尝试原文URL，失败后降级到AI生成
    if (request.imageUrl) {
      logger.logStep('processing_strategy', 'success', null, 'Using original URL processing with AI fallback');
      result = await processOriginalImageWithLogging(request.imageUrl, env, logger);

      // 如果原文URL失败且有prompt，尝试AI生成
      if (!result.success && request.prompt) {
        logger.logStep('fallback_decision', 'warning', null, 'Original URL failed, falling back to AI generation');
        result = await processAIGenerationWithLogging(request, env, baseUrl, logger);
      }
    } else if (request.prompt) {
      logger.logStep('processing_strategy', 'success', null, 'Using AI generation processing');
      result = await processAIGenerationWithLogging(request, env, baseUrl, logger);
    }

    // 存储到R2
    if (result.success && result.url) {
      logger.logStep('r2_storage_attempt', 'success', null, 'Starting R2 storage');
      try {
        const r2Url = await storeImageInR2(result.url, request.articleId, env, baseUrl);
        result.url = r2Url;
        result.r2Stored = true;
        logger.logStep('r2_storage', 'success', {
          originalUrl: result.originalUrl || result.url,
          r2Url: r2Url,
          articleId: request.articleId
        });
      } catch (r2Error) {
        const error = r2Error instanceof UnifiedImageError ? r2Error :
          UnifiedImageError.r2StorageError(
            r2Error instanceof Error ? r2Error.message : 'R2 storage failed',
            { originalUrl: result.url, articleId: request.articleId }
          );

        logger.logStep('r2_storage', 'warning', error.details, error.message);
        result.r2Stored = false;
        result.r2Error = error.message;
      }
    } else {
      logger.logStep('r2_storage_skip', 'warning', null, 'Skipping R2 storage due to processing failure');
    }

    // 构建最终结果
    const finalResult = {
      url: result.url || config.defaults.imageUrl,
      source: result.source || 'emergency-fallback',
      elapsedMs: logger.getTotalDuration(),
      success: result.success || false,
      r2Stored: result.r2Stored || false,
      error: result.error,
      originalUrl: result.originalUrl,
      usedPrompt: result.usedPrompt,
      details: result.details
    };

    logger.logStep('processing_complete', 'success', {
      finalUrl: finalResult.url,
      source: finalResult.source,
      success: finalResult.success,
      r2Stored: finalResult.r2Stored
    });

    // 保存处理日志
    await logger.saveLog(finalResult);

    return finalResult;

  } catch (error) {
    const unifiedError = error instanceof UnifiedImageError ? error :
      new UnifiedImageError(
        error instanceof Error ? error.message : 'Unknown error',
        'PROCESSING_FAILED',
        'general',
        { originalError: error }
      );

    logger.logStep('processing_failed', 'failure', unifiedError.details, unifiedError.message);

    const errorResult = {
      url: config.defaults.imageUrl,
      source: 'emergency-fallback',
      elapsedMs: logger.getTotalDuration(),
      success: false,
      r2Stored: false,
      error: unifiedError.message,
      details: {
        errorCode: unifiedError.code,
        errorStep: unifiedError.step,
        retryable: unifiedError.retryable,
        ...unifiedError.details
      }
    };

    // 保存错误日志
    await logger.saveLog(errorResult);

    return errorResult;
  }
}

// 带日志记录的原文图片处理函数
async function processOriginalImageWithLogging(imageUrl: string, env: Env, logger: UnifiedImageLogger): Promise<any> {
  logger.logStep('url_validation_start', 'success', { imageUrl }, 'Starting URL validation and download');

  try {
    // 基础URL验证
    logger.logStep('url_format_check', 'success', null, 'Checking URL format');
    try {
      const urlObj = new URL(imageUrl);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        throw UnifiedImageError.urlValidationError(
          `Invalid protocol: ${urlObj.protocol}. Only HTTP and HTTPS are supported.`,
          { protocol: urlObj.protocol, hostname: urlObj.hostname }
        );
      }
      logger.logStep('url_format_check', 'success', {
        protocol: urlObj.protocol,
        hostname: urlObj.hostname
      });
    } catch (urlError) {
      const error = urlError instanceof UnifiedImageError ? urlError :
        UnifiedImageError.urlValidationError(
          `Invalid URL format: ${urlError instanceof Error ? urlError.message : 'Unknown error'}`,
          { originalUrl: imageUrl }
        );
      logger.logStep('url_format_check', 'failure', error.details, error.message);
      throw error;
    }

    // 尝试下载图片
    logger.logStep('image_download_start', 'success', null, 'Starting image download');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

    const response = await fetch(imageUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'CloudflareWorker-ImageProcessor/1.0',
        'Accept': 'image/*'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw UnifiedImageError.downloadError(
        `HTTP ${response.status}: Failed to download image`,
        {
          status: response.status,
          statusText: response.statusText,
          url: imageUrl
        }
      );
    }

    logger.logStep('image_download', 'success', {
      status: response.status,
      finalUrl: response.url
    });

    // 验证Content-Type
    logger.logStep('content_type_validation', 'success', null, 'Validating content type');
    const contentType = response.headers.get('content-type');
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/bmp'];

    if (!contentType || !validTypes.some(type => contentType.includes(type))) {
      throw UnifiedImageError.downloadError(
        `Invalid content type: ${contentType}. Expected image type.`,
        { contentType, validTypes }
      );
    }

    logger.logStep('content_type_validation', 'success', { contentType });

    // 验证文件大小
    logger.logStep('file_size_validation', 'success', null, 'Validating file size');
    const contentLength = response.headers.get('content-length');
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (contentLength && parseInt(contentLength) > maxSize) {
      throw UnifiedImageError.downloadError(
        `File too large: ${contentLength} bytes (max: ${maxSize})`,
        { fileSize: parseInt(contentLength), maxSize }
      );
    }

    logger.logStep('file_size_validation', 'success', {
      contentLength: contentLength ? parseInt(contentLength) : 'unknown'
    });

    logger.logStep('original_image_processing', 'success', {
      finalUrl: response.url,
      contentType,
      contentLength
    }, 'Original image processed successfully');

    return {
      success: true,
      source: 'original',
      url: response.url || imageUrl,
      originalUrl: imageUrl,
      elapsedMs: logger.getTotalDuration()
    };

  } catch (error) {
    const unifiedError = error instanceof UnifiedImageError ? error :
      UnifiedImageError.downloadError(
        error instanceof Error ? error.message : 'Unknown download error',
        { originalUrl: imageUrl, originalError: error }
      );

    logger.logStep('original_image_processing', 'failure', unifiedError.details, unifiedError.message);

    return {
      success: false,
      source: 'original',
      url: '',
      originalUrl: imageUrl,
      elapsedMs: logger.getTotalDuration(),
      error: unifiedError.message,
      details: {
        errorCode: unifiedError.code,
        errorStep: unifiedError.step,
        ...unifiedError.details
      }
    };
  }
}

// 带日志记录的AI图片生成函数
async function processAIGenerationWithLogging(
  request: GenerateImageRequest,
  env: Env,
  baseUrl: string,
  logger: UnifiedImageLogger
): Promise<any> {
  logger.logStep('ai_generation_start', 'success', {
    prompt: request.prompt,
    provider: request.provider
  }, 'Starting AI generation');

  try {

    // 使用现有的AI生成逻辑（三级fallback）
    let aiResult: any;

    // 如果指定了特定提供商
    if (request.provider) {
      logger.logStep('provider_selection', 'success', {
        selectedProvider: request.provider
      }, `Using specified provider: ${request.provider}`);

      switch (request.provider) {
        case 'replicate':
          logger.logStep('replicate_generation', 'success', null, 'Starting Replicate generation');
          aiResult = await generateWithReplicate(request, env, Date.now(), baseUrl);
          break;
        case 'fal':
          logger.logStep('fal_generation', 'success', null, 'Starting Fal generation');
          aiResult = await generateWithFal(request, env, Date.now());
          break;
        case 'unsplash':
          logger.logStep('unsplash_generation', 'success', null, 'Starting Unsplash generation');
          aiResult = await generateWithUnsplash(request, env, Date.now());
          break;
        default:
          logger.logStep('default_provider', 'warning', {
            requestedProvider: request.provider
          }, 'Unknown provider, falling back to Unsplash');
          aiResult = await generateWithUnsplash(request, env, Date.now());
      }

      logger.logStep(`${request.provider}_result`, aiResult.success ? 'success' : 'failure', {
        provider: aiResult.provider,
        success: aiResult.success
      }, aiResult.success ? 'Provider generation succeeded' : `Provider generation failed: ${aiResult.error}`);
    } else {
      // 三级fallback: Replicate → Fal → Unsplash
      logger.logStep('fallback_strategy', 'success', null, 'Starting AI generation with fallback: Replicate → Fal → Unsplash');

      // 1. 尝试Replicate
      try {
        logger.logStep('replicate_attempt', 'success', null, 'Trying Replicate AI (25s timeout)');
        aiResult = await Promise.race([
          generateWithReplicate(request, env, Date.now(), baseUrl),
          new Promise<any>((_, reject) =>
            setTimeout(() => reject(new Error('Replicate timeout')), 25000)
          )
        ]);

        if (aiResult.success) {
          logger.logStep('replicate_success', 'success', {
            provider: aiResult.provider,
            url: aiResult.url ? '[GENERATED]' : '[NO_URL]'
          }, 'Replicate AI succeeded');
        } else {
          throw new Error(aiResult.error || 'Replicate failed');
        }
      } catch (error) {
        logger.logStep('replicate_failure', 'warning', {
          error: error instanceof Error ? error.message : 'Unknown error'
        }, 'Replicate AI failed, trying next provider');

        // 2. 尝试Fal
        try {
          logger.logStep('fal_attempt', 'success', null, 'Trying Fal AI (12s timeout)');
          aiResult = await Promise.race([
            generateWithFal(request, env, Date.now()),
            new Promise<any>((_, reject) =>
              setTimeout(() => reject(new Error('Fal timeout')), 12000)
            )
          ]);

          if (aiResult.success) {
            logger.logStep('fal_success', 'success', {
              provider: aiResult.provider,
              url: aiResult.url ? '[GENERATED]' : '[NO_URL]'
            }, 'Fal AI succeeded');
          } else {
            throw new Error(aiResult.error || 'Fal failed');
          }
        } catch (falError) {
          logger.logStep('fal_failure', 'warning', {
            error: falError instanceof Error ? falError.message : 'Unknown error'
          }, 'Fal AI failed, trying final fallback');

          // 3. 最后尝试Unsplash
          try {
            logger.logStep('unsplash_attempt', 'success', null, 'Falling back to Unsplash (final attempt)');
            aiResult = await generateWithUnsplash(request, env, Date.now());

            if (aiResult.success) {
              logger.logStep('unsplash_success', 'success', {
                provider: aiResult.provider,
                url: aiResult.url ? '[GENERATED]' : '[NO_URL]'
              }, 'Unsplash fallback succeeded');
            } else {
              throw new Error(aiResult.error || 'Unsplash failed');
            }
          } catch (unsplashError) {
            logger.logStep('all_providers_failed', 'failure', {
              error: unsplashError instanceof Error ? unsplashError.message : 'Unknown error'
            }, 'All AI providers failed');
            aiResult = {
              success: false,
              provider: 'emergency-fallback',
              error: 'All AI providers failed'
            };
          }
        }
      }
    }

    if (aiResult.success) {
      logger.logStep('ai_generation_complete', 'success', {
        finalProvider: aiResult.provider,
        hasUrl: !!aiResult.url
      }, 'AI generation completed successfully');

      return {
        success: true,
        source: aiResult.provider,
        url: aiResult.url,
        usedPrompt: request.prompt,
        elapsedMs: logger.getTotalDuration()
      };
    } else {
      logger.logStep('ai_generation_complete', 'failure', {
        finalProvider: aiResult.provider,
        error: aiResult.error
      }, 'AI generation failed completely');

      return {
        success: false,
        source: 'emergency-fallback',
        url: '',
        usedPrompt: request.prompt,
        elapsedMs: logger.getTotalDuration(),
        error: aiResult.error,
        details: {
          aiGenerationError: aiResult.error,
          finalProvider: aiResult.provider
        }
      };
    }

  } catch (error) {
    const unifiedError = error instanceof UnifiedImageError ? error :
      UnifiedImageError.aiGenerationError(
        error instanceof Error ? error.message : 'Unknown AI generation error',
        { prompt: request.prompt, provider: request.provider }
      );

    logger.logStep('ai_generation_exception', 'failure', unifiedError.details, unifiedError.message);

    return {
      success: false,
      source: 'emergency-fallback',
      url: '',
      usedPrompt: request.prompt,
      elapsedMs: logger.getTotalDuration(),
      error: unifiedError.message,
      details: {
        errorCode: unifiedError.code,
        errorStep: unifiedError.step,
        ...unifiedError.details
      }
    };
  }
}

// 增强的错误处理和日志记录功能
class UnifiedImageLogger {
  private env: Env;
  private requestId: string;
  private startTime: number;
  private steps: Array<{
    step: string;
    status: 'success' | 'failure' | 'warning';
    duration: number;
    error?: string;
    details?: any;
  }> = [];

  constructor(env: Env, requestId: string) {
    this.env = env;
    this.requestId = requestId;
    this.startTime = Date.now();
  }

  logStep(step: string, status: 'success' | 'failure' | 'warning', details?: any, error?: string) {
    const duration = Date.now() - this.startTime;
    const stepInfo = {
      step,
      status,
      duration,
      error,
      details
    };

    this.steps.push(stepInfo);

    // 控制台日志
    const logLevel = status === 'failure' ? 'error' : status === 'warning' ? 'warn' : 'log';
    console[logLevel](`[${this.requestId}] ${step}: ${status}`, {
      duration: `${duration}ms`,
      error,
      details
    });
  }

  async saveLog(finalResult: any) {
    try {
      const logData = {
        requestId: this.requestId,
        timestamp: new Date().toISOString(),
        totalDuration: Date.now() - this.startTime,
        steps: this.steps,
        finalResult,
        success: finalResult.success
      };

      // 保存到KV存储
      const logKey = `unified_log:${this.requestId}`;
      await this.env.STATE_KV.put(logKey, JSON.stringify(logData), {
        expirationTtl: 24 * 60 * 60 // 24小时过期
      });

      console.log(`[${this.requestId}] Processing log saved successfully`);
    } catch (error) {
      console.error(`[${this.requestId}] Failed to save processing log:`, error);
      // 不抛出错误，避免影响主流程
    }
  }

  getSteps() {
    return this.steps;
  }

  getTotalDuration() {
    return Date.now() - this.startTime;
  }
}

// 增强的错误处理类
class UnifiedImageError extends Error {
  public readonly code: string;
  public readonly step: string;
  public readonly details?: any;
  public readonly retryable: boolean;

  constructor(
    message: string,
    code: string,
    step: string,
    details?: any,
    retryable: boolean = false
  ) {
    super(message);
    this.name = 'UnifiedImageError';
    this.code = code;
    this.step = step;
    this.details = details;
    this.retryable = retryable;
  }

  static urlValidationError(message: string, details?: any): UnifiedImageError {
    return new UnifiedImageError(message, 'URL_VALIDATION_FAILED', 'url_validation', details, false);
  }

  static downloadError(message: string, details?: any): UnifiedImageError {
    return new UnifiedImageError(message, 'DOWNLOAD_FAILED', 'url_download', details, true);
  }

  static aiGenerationError(message: string, details?: any): UnifiedImageError {
    return new UnifiedImageError(message, 'AI_GENERATION_FAILED', 'ai_generation', details, true);
  }

  static r2StorageError(message: string, details?: any): UnifiedImageError {
    return new UnifiedImageError(message, 'R2_STORAGE_FAILED', 'r2_storage', details, true);
  }

  static configurationError(message: string, details?: any): UnifiedImageError {
    return new UnifiedImageError(message, 'CONFIGURATION_ERROR', 'configuration', details, false);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      step: this.step,
      details: this.details,
      retryable: this.retryable,
      stack: this.stack
    };
  }
}
