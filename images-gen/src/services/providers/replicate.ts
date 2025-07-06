import {
  GenerateImageRequest,
  ProviderResult,
  Env,
  ProviderConfig,
  ReplicateResponse,
  ImageGenerationError
} from '@/types';
import { createTimeout } from '@/utils/common';
import { validateImageDimensions } from '@/utils/validation';

// Replicate API endpoints
const REPLICATE_API_BASE = 'https://api.replicate.com/v1';
const DEFAULT_MODEL = 'stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b';

// Webhook endpoint for receiving Replicate callbacks
const WEBHOOK_ENDPOINT = '/api/replicate/webhook';

/**
 * Generate image using Replicate API with webhook support
 */
export async function generateWithReplicate(
  request: GenerateImageRequest,
  env: Env,
  config: ProviderConfig
): Promise<ProviderResult> {
  if (!env.REPLICATE_API_TOKEN) {
    throw new ImageGenerationError('Replicate API token not configured', 'replicate');
  }

  const { width, height } = validateImageDimensions(request.width, request.height);

  try {
    // Create prediction (without webhook for development)
    const prediction = await createPredictionWithWebhook(request, env, width, height);

    // Use polling to wait for result (since webhook is disabled)
    const result = await Promise.race([
      pollPrediction(prediction.id, env, config),
      createTimeout(config.timeout, 'Replicate generation timed out'),
    ]);

    if (!result.success || !result.url) {
      throw new ImageGenerationError(
        result.error || 'Failed to generate image',
        'replicate'
      );
    }

    return {
      success: true,
      url: result.url,
      provider: 'replicate',
      elapsedMs: 0, // Will be set by caller
    };
  } catch (error) {
    if (error instanceof ImageGenerationError) {
      throw error;
    }

    throw new ImageGenerationError(
      `Replicate error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'replicate',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Create a new prediction with webhook support
 */
async function createPredictionWithWebhook(
  request: GenerateImageRequest,
  env: Env,
  width: number,
  height: number
): Promise<{ id: string; status: string }> {
  const input = {
    prompt: request.prompt,
    width,
    height,
    num_outputs: 1,
    num_inference_steps: 20,
    guidance_scale: 7.5,
    scheduler: 'K_EULER',
    seed: Math.floor(Math.random() * 1000000),
  };

  // Add style if provided
  if (request.style) {
    input.prompt = `${request.prompt}, ${request.style}`;
  }

  // For development, we'll skip webhook and use polling instead
  // In production, you would use: `https://your-worker-domain.workers.dev${WEBHOOK_ENDPOINT}`
  const webhookUrl = null; // Disable webhook for development

  const requestBody: any = {
    version: DEFAULT_MODEL,
    input,
  };

  // Only add webhook if URL is provided
  if (webhookUrl) {
    requestBody.webhook = webhookUrl;
    requestBody.webhook_events_filter = ['completed'];
  }

  const response = await fetch(`${REPLICATE_API_BASE}/predictions`, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${env.REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create prediction: ${response.status} ${errorText}`);
  }

  return await response.json();
}

/**
 * Wait for webhook result with fallback to polling
 */
async function waitForWebhookResult(
  predictionId: string,
  env: Env,
  config: ProviderConfig
): Promise<{ success: boolean; url?: string; error?: string }> {
  const webhookCheckInterval = 2000; // Check every 2 seconds
  const maxWebhookWait = Math.min(config.timeout, 60000); // Max 1 minute for webhook
  const startTime = Date.now();

  // First, try to get result from webhook (stored in KV)
  while (Date.now() - startTime < maxWebhookWait) {
    try {
      const webhookResult = await env.STATE_KV.get(`replicate:${predictionId}`);
      if (webhookResult) {
        const result = JSON.parse(webhookResult);
        // Clean up the KV entry
        await env.STATE_KV.delete(`replicate:${predictionId}`);
        return result;
      }
    } catch (error) {
      console.error('Error checking webhook result:', error);
    }

    await new Promise(resolve => setTimeout(resolve, webhookCheckInterval));
  }

  // Fallback to polling if webhook didn't deliver result
  console.log(`Webhook timeout for ${predictionId}, falling back to polling`);
  return await pollPrediction(predictionId, env, config);
}

/**
 * Poll prediction until completion (fallback method)
 */
async function pollPrediction(
  predictionId: string,
  env: Env,
  config: ProviderConfig
): Promise<{ success: boolean; url?: string; error?: string }> {
  const maxAttempts = Math.floor(config.timeout / 2000); // Poll every 2 seconds
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(`${REPLICATE_API_BASE}/predictions/${predictionId}`, {
        headers: {
          'Authorization': `Token ${env.REPLICATE_API_TOKEN}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get prediction: ${response.status}`);
      }

      const prediction: ReplicateResponse = await response.json();

      switch (prediction.status) {
        case 'succeeded':
          if (prediction.output && prediction.output.length > 0) {
            return {
              success: true,
              url: prediction.output[0],
            };
          }
          return {
            success: false,
            error: 'No output generated',
          };

        case 'failed':
        case 'canceled':
          return {
            success: false,
            error: prediction.error || `Prediction ${prediction.status}`,
          };

        case 'starting':
        case 'processing':
          // Continue polling
          await new Promise(resolve => setTimeout(resolve, 2000));
          break;

        default:
          throw new Error(`Unknown prediction status: ${prediction.status}`);
      }
    } catch (error) {
      console.error(`Polling attempt ${attempt + 1} failed:`, error);
      
      // If this is the last attempt, throw the error
      if (attempt === maxAttempts - 1) {
        throw error;
      }
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  return {
    success: false,
    error: 'Polling timeout exceeded',
  };
}

/**
 * Handle Replicate webhook callback
 */
export async function handleReplicateWebhook(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    // Validate webhook signature if needed
    // const signature = request.headers.get('webhook-signature');
    // if (!validateWebhookSignature(signature, body, env.REPLICATE_WEBHOOK_SECRET)) {
    //   return new Response('Invalid signature', { status: 401 });
    // }

    const prediction: ReplicateResponse = await request.json();

    console.log('Received Replicate webhook:', {
      id: prediction.id,
      status: prediction.status,
    });

    // Store the result in KV for retrieval by the main request
    if (prediction.status === 'succeeded' && prediction.output) {
      await env.STATE_KV.put(
        `replicate:${prediction.id}`,
        JSON.stringify({
          success: true,
          url: prediction.output[0],
          status: prediction.status,
        }),
        { expirationTtl: 3600 } // 1 hour
      );
    } else if (prediction.status === 'failed') {
      await env.STATE_KV.put(
        `replicate:${prediction.id}`,
        JSON.stringify({
          success: false,
          error: prediction.error || 'Prediction failed',
          status: prediction.status,
        }),
        { expirationTtl: 3600 }
      );
    }

    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('Webhook error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

/**
 * Cancel a prediction
 */
export async function cancelPrediction(predictionId: string, env: Env): Promise<void> {
  try {
    await fetch(`${REPLICATE_API_BASE}/predictions/${predictionId}/cancel`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${env.REPLICATE_API_TOKEN}`,
      },
    });
  } catch (error) {
    console.error('Failed to cancel prediction:', error);
  }
}
