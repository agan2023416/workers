// No imports for now - inline everything

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
  prompt: string;
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
          console.log('Handling image generation request');
          if (request.method !== 'POST') {
            return createErrorResponse('Method Not Allowed', 405);
          }

          try {
            const body = await request.json() as GenerateImageRequest;
            console.log('Request body:', body);

            // Use the real image generation function
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
