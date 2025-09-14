import {
  GenerateImageRequest,
  ProviderResult,
  Env,
  ProviderConfig,
  ReplicateResponse,
  ImageGenerationError,
  ImageModel,
  AppConfig
} from '@/types';
import { createTimeout } from '@/utils/common';
import { validateImageDimensions } from '@/utils/validation';

// Replicate API endpoints
const REPLICATE_API_BASE = 'https://api.replicate.com/v1';
const DEFAULT_MODEL = 'black-forest-labs/flux-1.1-pro'; // 更新为flux 1.1 pro

// Webhook endpoint for receiving Replicate callbacks (unused in dev; kept for reference)
// const WEBHOOK_ENDPOINT = '/api/replicate/webhook';

/**
 * Get Replicate model identifier based on selected model
 */
function getReplicateModel(model: ImageModel, config: AppConfig): string {
  const replicateModels = config.models.replicate;
  return replicateModels[model] || replicateModels['flux-1.1-pro'] || DEFAULT_MODEL;
}

/**
 * Generate image using Replicate API with webhook support
 */
export async function generateWithReplicate(
  request: GenerateImageRequest,
  env: Env,
  config: ProviderConfig,
  appConfig: AppConfig
): Promise<ProviderResult> {
  console.log('generateWithReplicate called with:', {
    prompt: request.prompt,
    model: request.model,
    provider: request.provider,
    hasToken: !!env.REPLICATE_API_TOKEN
  });

  if (!env.REPLICATE_API_TOKEN) {
    console.error('Replicate API token not configured');
    throw new ImageGenerationError('Replicate API token not configured', 'replicate');
  }

  const { width, height } = validateImageDimensions(request.width, request.height);

  try {
    // Create prediction (without webhook for development)
    const selectedModel = request.model || appConfig.defaults.model;
    const prediction = await createPredictionWithWebhook(request, env, width, height, selectedModel, appConfig);

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
      actualModel: getReplicateModel(selectedModel, appConfig), // 添加实际使用的模型端点
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
  height: number,
  model: ImageModel,
  appConfig: AppConfig
): Promise<{ id: string; status: string }> {
  // 根据模型类型构建不同的input参数
  let input: any;

  if (model === 'flux-1.1-pro' || model === 'flux-1.1-dev' || model === 'flux-schnell') {
    // Flux模型使用新的参数格式
    input = {
      prompt: request.prompt,
      aspect_ratio: width === height ? "1:1" : width > height ? "16:9" : "9:16",
      output_format: "webp",
      safety_tolerance: 2,
      seed: Math.floor(Math.random() * 1000000),
    };
  } else {
    // 其他模型使用旧的SDXL格式
    input = {
      prompt: request.prompt,
      width,
      height,
      num_outputs: 1,
      num_inference_steps: 20,
      guidance_scale: 7.5,
      scheduler: 'K_EULER',
      seed: Math.floor(Math.random() * 1000000),
    };
  }

  // Add style if provided
  if (request.style) {
    input.prompt = `${request.prompt}, ${request.style}`;
  }

  // For development, we'll skip webhook and use polling instead
  // In production, you would use: `https://your-worker-domain.workers.dev${WEBHOOK_ENDPOINT}`
  const webhookUrl = null; // Disable webhook for development

  const selectedModelId = getReplicateModel(model, appConfig);

  const requestBody: any = {
    input,
  };

  // 确定API URL和请求体格式
  let apiUrl: string;
  if (model === 'flux-1.1-pro' || model === 'flux-1.1-dev' || model === 'flux-schnell') {
    // 新的Flux模型使用模型名称调用
    apiUrl = `${REPLICATE_API_BASE}/models/${selectedModelId}/predictions`;
  } else {
    // 旧模型使用version字段和通用predictions端点
    requestBody.version = selectedModelId;
    apiUrl = `${REPLICATE_API_BASE}/predictions`;
  }

  // Only add webhook if URL is provided
  if (webhookUrl) {
    requestBody.webhook = webhookUrl;
    requestBody.webhook_events_filter = ['completed'];
  }

  console.log('Replicate API request:', {
    url: apiUrl,
    body: requestBody,
    model: selectedModelId,
    headers: {
      'Authorization': `Token ${env.REPLICATE_API_TOKEN ? '[REDACTED]' : 'MISSING'}`,
      'Content-Type': 'application/json',
    }
  });

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${env.REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Replicate API error:', {
      status: response.status,
      statusText: response.statusText,
      error: errorText,
      url: apiUrl,
      model: selectedModelId
    });
    throw new Error(`Failed to create prediction: ${response.status} ${errorText}`);
  }

  return await response.json();
}

/**
 * Wait for webhook result with fallback to polling
 */
// waitForWebhookResult removed (unused in dev)

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
          if (prediction.output) {
            // Handle different output formats
            let imageUrl: string;
            if (Array.isArray(prediction.output)) {
              // Old format (SDXL, etc.) - array of URLs
              imageUrl = prediction.output[0];
            } else if (typeof prediction.output === 'string') {
              // New format (Flux 1.1 Pro) - single URL string
              imageUrl = prediction.output;
            } else {
              return {
                success: false,
                error: 'Invalid output format',
              };
            }

            if (imageUrl) {
              return {
                success: true,
                url: imageUrl,
              };
            }
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
