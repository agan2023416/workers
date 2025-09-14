// Clean modular architecture - Worker entry point
import {
  Env,
  GenerateImageRequest,
  GenerateImageResponse
} from './types';
import { getConfig } from './config';
import { generateImage } from './services/imageGenerator';
import { processUnifiedImageRequest } from './services/unifiedImageProcessor';
import { createSuccessResponse, createErrorResponse } from './utils/response';
import { authenticateRequest, hmacSha256Hex, safeEqual } from './utils/auth';
import { handleReplicateWebhook } from './services/providers/replicate';
import { getDefaultConfig, mapSourceToProvider } from './utils/defaultConfig';
import { uploadToR2 } from './services/r2Storage';

/**
 * Main Cloudflare Worker - Clean Architecture
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    try {
      console.log(`${request.method} ${request.url}`);

      // Handle CORS preflight
      if (request.method === 'OPTIONS') {
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

      // Authentication check
      const isPublicEndpoint =
        path === '/health' ||
        (path === '/images/r2' && request.method === 'GET') ||
        (path === '/replicate/webhook' && request.method === 'POST') ||
        ((path === '/images/result' || path === '/status') && request.method === 'GET');

      if (!isPublicEndpoint && !authenticateRequest(request, env)) {
        return createErrorResponse('Unauthorized - API key required', 401);
      }

      // Route handlers
      switch (path) {
        case '/health':
          return handleHealthCheck(env);

        case '/test-r2':
          return handleR2Test(request, env);

        case '/test-replicate':
          return handleReplicateTest(env);

        case '/replicate/webhook':
          return handleReplicateWebhook(request, env);

        case '/images/generate':
          return handleImageGeneration(request, env);

        case '/images/r2':
          return handleR2ImageAccess(request, env);

        case '/images/result':
        case '/status':
          return handleStatusQuery(request, env);

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

/**
 * Health check handler
 */
async function handleHealthCheck(env: Env): Promise<Response> {
  return createSuccessResponse({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    secrets: {
      replicate: !!env.REPLICATE_API_TOKEN,
      fal: !!env.FAL_KEY,
      unsplash: !!env.UNSPLASH_ACCESS_KEY,
      api: !!env.API_KEY,
    }
  });
}

/**
 * R2 test handler
 */
async function handleR2Test(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return createErrorResponse('Method Not Allowed', 405);
  }

  try {
    const body = await request.json() as { imageUrl: string; articleId?: string };
    if (!body.imageUrl) {
      return createErrorResponse('Missing imageUrl', 400);
    }

    const config = await getConfig(env);
    const url = await uploadToR2(body.imageUrl, env, config);

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
}

/**
 * Replicate test handler
 */
async function handleReplicateTest(env: Env): Promise<Response> {
  try {
    if (!env.REPLICATE_API_TOKEN) {
      return createErrorResponse('REPLICATE_API_TOKEN not configured', 500);
    }

    const testResponse = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro', {
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
}

/**
 * Image generation handler
 */
async function handleImageGeneration(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return createErrorResponse('Method Not Allowed', 405);
  }

  try {
    const body = await request.json() as GenerateImageRequest;
    console.log('Request body:', body);
    console.log('Request analysis:', {
      hasImageUrl: !!body.imageUrl,
      hasPrompt: !!body.prompt,
      imageUrlValue: body.imageUrl,
      imageUrlType: typeof body.imageUrl,
      imageUrlUndefined: body.imageUrl === undefined
    });

    // Use unified processor for new requests
    const useUnifiedProcessor = body.imageUrl || (body.prompt && body.imageUrl === undefined);
    console.log('Using unified processor:', useUnifiedProcessor);

    if (useUnifiedProcessor) {
      console.log('Using unified image processor');
      const config = await getConfig(env);
      const unifiedResult = await processUnifiedImageRequest(
        body,
        env,
        config,
        new URL(request.url).origin
      );

      // Convert to compatible response format
      const compatibleResult = {
        url: unifiedResult.url,
        provider: mapSourceToProvider(unifiedResult.source),
        elapsedMs: unifiedResult.elapsedMs,
        success: unifiedResult.success,
        error: unifiedResult.error,
        r2Stored: unifiedResult.r2Stored,
        r2Error: unifiedResult.details?.r2StorageError,
        source: unifiedResult.source,
        originalUrl: unifiedResult.originalUrl,
        usedPrompt: unifiedResult.usedPrompt,
        ...(unifiedResult.actualModel && { actualModel: unifiedResult.actualModel }) // 只在有模型时添加
      };

      return createSuccessResponse(compatibleResult);
    }

    // Legacy logic for backward compatibility
    console.log('Using legacy image generation logic');
    const config = await getConfig(env);
    const result = await generateImage(body, env, config);

    return createSuccessResponse(result);
  } catch (error) {
    console.error('Error in image generation:', error);
    return createErrorResponse(
      error instanceof Error ? error.message : 'Image generation failed',
      500
    );
  }
}

/**
 * R2 image access handler
 */
async function handleR2ImageAccess(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') {
    return createErrorResponse('Method Not Allowed', 405);
  }

  try {
    const url = new URL(request.url);
    const key = url.searchParams.get('key');

    if (!key) {
      return createErrorResponse('Missing key parameter', 400);
    }

    const object = await env.IMAGES_BUCKET.get(key);
    if (!object) {
      return createErrorResponse('Image not found', 404);
    }

    const headers = new Headers();
    headers.set('Content-Type', object.httpMetadata?.contentType || 'image/jpeg');
    headers.set('Cache-Control', 'public, max-age=31536000');
    headers.set('Access-Control-Allow-Origin', '*');

    return new Response(object.body, { headers, status: 200 });
  } catch (error) {
    console.error('Error serving R2 image:', error);
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to serve image',
      500
    );
  }
}

/**
 * Status query handler
 */
async function handleStatusQuery(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') {
    return createErrorResponse('Method Not Allowed', 405);
  }

  try {
    const urlObj = new URL(request.url);
    const taskId = urlObj.searchParams.get('taskId');
    if (!taskId) {
      return createErrorResponse('Missing taskId', 400);
    }

    const resultRaw = await env.STATE_KV.get(`replicate:result:${taskId}`);
    if (!resultRaw) {
      return createSuccessResponse({ status: 'pending' });
    }

    const result = JSON.parse(resultRaw);
    return createSuccessResponse(result);
  } catch (error) {
    console.error('Error in status query:', error);
    return createErrorResponse('Failed to fetch status', 500);
  }
}
