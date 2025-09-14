import {
  GenerateImageRequest,
  ProviderResult,
  Env,
  ProviderConfig,
  FalResponse,
  ImageGenerationError,
  ImageModel,
  AppConfig
} from '@/types';
import { createTimeout, retry } from '@/utils/common';
import { validateImageDimensions } from '@/utils/validation';

// Fal API configuration - 使用queue.fal.run作为最佳实践
const FAL_API_BASE = 'https://fal.run';
const DEFAULT_MODEL = 'fal-ai/flux-pro'; // FLUX.1 [pro] - Fal没有1.1版本

/**
 * Get Fal model identifier based on selected model
 */
function getFalModel(model: ImageModel, config: AppConfig): string {
  const falModels = config.models.fal;
  const selectedModel = falModels[model] || falModels['flux-1.1-pro'] || DEFAULT_MODEL;
  console.log('getFalModel:', {
    requestedModel: model,
    availableModels: Object.keys(falModels),
    selectedModel,
    fallbackUsed: !falModels[model]
  });
  return selectedModel;
}

/**
 * Generate image using Fal API
 */
export async function generateWithFal(
  request: GenerateImageRequest,
  env: Env,
  config: ProviderConfig,
  appConfig: AppConfig
): Promise<ProviderResult> {
  console.log('generateWithFal called with:', {
    prompt: request.prompt,
    model: request.model,
    provider: request.provider,
    hasKey: !!env.FAL_KEY,
    falKeyLength: env.FAL_KEY ? env.FAL_KEY.length : 0
  });

  if (!env.FAL_KEY) {
    console.error('Fal API key not configured');
    console.error('Available env keys:', Object.keys(env));
    throw new ImageGenerationError('Fal API key not configured', 'fal');
  }

  const { width, height } = validateImageDimensions(request.width, request.height);

  try {
    const selectedModel = request.model || appConfig.defaults.model;
    const result = await retry(
      () => generateSingleRequest(request, env, width, height, config, selectedModel, appConfig),
      {
        maxRetries: config.retries,
        baseDelay: 1000,
        maxDelay: 5000,
        backoffFactor: 2,
      }
    );

    return {
      success: true,
      url: result.url,
      provider: 'fal',
      elapsedMs: 0, // Will be set by caller
      actualModel: result.actualModel, // 从generateSingleRequest获取实际模型端点
    };
  } catch (error) {
    if (error instanceof ImageGenerationError) {
      throw error;
    }
    
    throw new ImageGenerationError(
      `Fal error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'fal',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Make a single generation request to Fal using the subscribe pattern
 */
async function generateSingleRequest(
  request: GenerateImageRequest,
  env: Env,
  width: number,
  height: number,
  config: ProviderConfig,
  model: ImageModel,
  appConfig: AppConfig
): Promise<{ url: string; actualModel: string }> {
  let prompt = request.prompt;

  // Add style if provided
  if (request.style) {
    prompt = `${prompt}, ${request.style}`;
  }

  // 根据尺寸确定Fal.ai的image_size枚举值
  let imageSize: string;
  if (width === height) {
    imageSize = width >= 1024 ? "square_hd" : "square";
  } else if (width > height) {
    // 横向
    const ratio = width / height;
    if (ratio >= 1.7) {
      imageSize = "landscape_16_9";
    } else {
      imageSize = "landscape_4_3";
    }
  } else {
    // 纵向
    const ratio = height / width;
    if (ratio >= 1.7) {
      imageSize = "portrait_16_9";
    } else {
      imageSize = "portrait_4_3";
    }
  }

  const selectedModelId = getFalModel(model, appConfig);

  // 根据模型调整参数
  const isSchnell = selectedModelId.includes('/schnell');

  const payload = {
    prompt,
    image_size: imageSize, // 使用正确的枚举值
    num_inference_steps: isSchnell ? 4 : 28, // Schnell使用4步，其他使用28步
    guidance_scale: 3.5, // 使用官方默认值
    num_images: 1,
    output_format: "jpeg", // 使用官方默认值
    seed: Math.floor(Math.random() * 1000000),
    ...(isSchnell && {
      enable_safety_checker: true, // Schnell特有参数
      acceleration: "none" // Schnell特有参数
    }),
    ...(!isSchnell && {
      safety_tolerance: "2" // 非Schnell模型使用safety_tolerance
    })
  };

  console.log('Fal API request:', {
    url: `${FAL_API_BASE}/${selectedModelId}`,
    payload,
    headers: {
      'Authorization': `Key ${env.FAL_KEY ? '[REDACTED]' : 'MISSING'}`,
      'Content-Type': 'application/json',
    }
  });

  // Use Fal's subscribe pattern for better reliability
  const response = await Promise.race([
    fetch(`${FAL_API_BASE}/${selectedModelId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${env.FAL_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }),
    createTimeout(config.timeout, 'Fal request timed out'),
  ]);

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `HTTP ${response.status}`;

    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.detail || errorJson.message || errorJson.error || errorMessage;
      console.error('Fal API error details:', errorJson);
    } catch {
      errorMessage = errorText || errorMessage;
      console.error('Fal API error text:', errorText);
    }

    console.error(`Fal API failed with status ${response.status}: ${errorMessage}`);
    throw new Error(`Fal API error: ${errorMessage}`);
  }

  const result: FalResponse = await response.json();

  console.log('Fal API response:', JSON.stringify(result, null, 2));

  if (!result.images || result.images.length === 0) {
    console.error('Fal response missing images:', result);
    throw new Error('No images generated by Fal');
  }

  const imageUrl = result.images[0]?.url;
  if (!imageUrl) {
    console.error('Fal response missing image URL:', result.images[0]);
    throw new Error('Invalid image URL from Fal');
  }

  console.log('Fal generated image URL:', imageUrl);
  return {
    url: imageUrl,
    actualModel: selectedModelId // 添加实际使用的模型端点
  };
}

/**
 * Get available Fal models
 */
export async function getFalModels(env: Env): Promise<string[]> {
  if (!env.FAL_KEY) {
    return [];
  }

  try {
    // Fal doesn't have a public models endpoint, return known models
    return [
      'fal-ai/flux-pro',
      'fal-ai/flux/dev',
      'fal-ai/flux/schnell',
      'fal-ai/fast-sdxl',
      'fal-ai/stable-diffusion-v3-medium',
      'fal-ai/aura-flow',
    ];
  } catch (error) {
    console.error('Error fetching Fal models:', error);
    return [DEFAULT_MODEL];
  }
}

/**
 * Validate Fal API key
 */
export async function validateFalKey(apiKey: string): Promise<boolean> {
  try {
    // Test with a simple model call to validate the key
    const response = await fetch(`${FAL_API_BASE}/${DEFAULT_MODEL}`, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'test',
        image_size: '512x512',
        num_images: 1,
      }),
    });

    // A 401 means invalid key, other errors might be quota/rate limits
    return response.status !== 401;
  } catch {
    return false;
  }
}
