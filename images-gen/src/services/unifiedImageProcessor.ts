/**
 * 统一图片处理服务
 * 支持原文URL下载和AI生成两种模式，实现自动降级机制
 */

import {
  GenerateImageRequest,
  UnifiedImageResponse,
  ImageProcessingResult,
  ProcessingStep,
  ProcessingLog,
  ImageSource,
  Env,
  AppConfig
} from '@/types';
import { validateAndDownloadImage } from '@/utils/urlValidator';
import { uploadToR2 } from '@/services/r2Storage';
import { generateWithReplicate } from '@/services/providers/replicate';
import { generateWithFal } from '@/services/providers/fal';
import { generateWithUnsplash } from '@/services/providers/unsplash';

/**
 * 统一图片处理主函数
 */
export async function processUnifiedImageRequest(
  request: GenerateImageRequest,
  env: Env,
  config: AppConfig,
  baseUrl: string
): Promise<UnifiedImageResponse> {
  const startTime = Date.now();
  const requestId = generateRequestId();
  const processingLog: ProcessingLog = {
    requestId,
    timestamp: new Date().toISOString(),
    imageUrl: request.imageUrl,
    prompt: request.prompt,
    articleId: request.articleId,
    steps: [],
    finalResult: {
      source: 'emergency-fallback',
      url: config.defaults.imageUrl,
      success: false
    }
  };

  console.log(`[${requestId}] Starting unified image processing`, {
    imageUrl: request.imageUrl,
    prompt: request.prompt,
    articleId: request.articleId
  });

  try {
    // 参数验证
    const validationResult = validateRequest(request);
    if (!validationResult.isValid) {
      return createErrorResponse(validationResult.error!, startTime, processingLog);
    }

    // 处理流程：优先尝试原文URL，失败后降级到AI生成
    let result: ImageProcessingResult;

    if (request.imageUrl) {
      console.log(`[${requestId}] Attempting to process original image URL`);
      result = await processOriginalImage(request.imageUrl, env, config, processingLog);
      
      // 如果原文URL失败且有prompt，尝试AI生成
      if (!result.success && request.prompt) {
        console.log(`[${requestId}] Original URL failed, falling back to AI generation`);
        result = await processAIGeneration(request, env, config, baseUrl, processingLog);
      }
    } else if (request.prompt) {
      console.log(`[${requestId}] Processing AI generation request`);
      result = await processAIGeneration(request, env, config, baseUrl, processingLog);
    } else {
      // 这种情况在参数验证中应该已经被捕获
      throw new Error('Neither imageUrl nor prompt provided');
    }

    // 存储到R2
    if (result.success && result.url) {
      const r2Result = await storeToR2(result.url, request.articleId, env, baseUrl, processingLog);
      if (r2Result.success) {
        result.url = r2Result.url!;
      } else {
        // R2存储失败，但保持原URL
        console.warn(`[${requestId}] R2 storage failed, keeping original URL`);
      }
    }

    // 更新最终结果
    processingLog.finalResult = {
      source: result.source,
      url: result.url,
      success: result.success
    };

    // 记录处理日志
    await recordProcessingLog(processingLog, env);

    return createSuccessResponse(result, startTime);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[${requestId}] Unified image processing failed:`, errorMessage);
    
    // 记录错误步骤
    processingLog.steps.push({
      step: 'ai_generation',
      status: 'failure',
      duration: Date.now() - startTime,
      error: errorMessage
    });

    await recordProcessingLog(processingLog, env);
    return createErrorResponse(errorMessage, startTime, processingLog);
  }
}

/**
 * 验证请求参数
 */
function validateRequest(request: GenerateImageRequest): { isValid: boolean; error?: string } {
  if (!request.imageUrl && !request.prompt) {
    return {
      isValid: false,
      error: 'Either imageUrl or prompt must be provided'
    };
  }

  if (request.imageUrl) {
    try {
      new URL(request.imageUrl);
    } catch {
      return {
        isValid: false,
        error: 'Invalid imageUrl format'
      };
    }
  }

  if (request.prompt && request.prompt.trim().length === 0) {
    return {
      isValid: false,
      error: 'Prompt cannot be empty'
    };
  }

  return { isValid: true };
}

/**
 * 处理原文图片URL
 */
async function processOriginalImage(
  imageUrl: string,
  env: Env,
  config: AppConfig,
  processingLog: ProcessingLog
): Promise<ImageProcessingResult> {
  const stepStartTime = Date.now();
  
  try {
    console.log(`Validating and downloading original image: ${imageUrl}`);
    
    // 验证并下载图片
    const downloadResult = await validateAndDownloadImage(
      imageUrl,
      config.urlValidation
    );

    const stepDuration = Date.now() - stepStartTime;

    if (!downloadResult.isValid) {
      processingLog.steps.push({
        step: 'url_validation',
        status: 'failure',
        duration: stepDuration,
        error: downloadResult.error
      });

      return {
        success: false,
        source: 'original',
        url: '',
        originalUrl: imageUrl,
        elapsedMs: stepDuration,
        error: downloadResult.error,
        details: {
          urlValidation: {
            isValid: false,
            error: downloadResult.error
          }
        }
      };
    }

    processingLog.steps.push({
      step: 'url_download',
      status: 'success',
      duration: stepDuration,
      details: {
        contentType: downloadResult.contentType,
        fileSize: downloadResult.imageBuffer?.byteLength
      }
    });

    console.log(`Original image downloaded successfully: ${imageUrl}`);

    return {
      success: true,
      source: 'original',
      url: downloadResult.finalUrl || imageUrl,
      originalUrl: imageUrl,
      elapsedMs: stepDuration
    };

  } catch (error) {
    const stepDuration = Date.now() - stepStartTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown download error';

    processingLog.steps.push({
      step: 'url_download',
      status: 'failure',
      duration: stepDuration,
      error: errorMessage
    });

    return {
      success: false,
      source: 'original',
      url: '',
      originalUrl: imageUrl,
      elapsedMs: stepDuration,
      error: errorMessage,
      details: {
        downloadError: errorMessage
      }
    };
  }
}

/**
 * 处理AI图片生成
 */
async function processAIGeneration(
  request: GenerateImageRequest,
  env: Env,
  config: AppConfig,
  baseUrl: string,
  processingLog: ProcessingLog
): Promise<ImageProcessingResult> {
  const stepStartTime = Date.now();

  try {
    console.log(`Starting AI generation with prompt: ${request.prompt}`);

    // 使用现有的AI生成逻辑（三级fallback）
    const aiResult = await generateImageWithFallback(request, env, config, baseUrl);
    const stepDuration = Date.now() - stepStartTime;

    if (aiResult.success) {
      processingLog.steps.push({
        step: 'ai_generation',
        status: 'success',
        duration: stepDuration,
        details: {
          provider: aiResult.provider,
          prompt: request.prompt
        }
      });

      return {
        success: true,
        source: aiResult.provider as ImageSource,
        url: aiResult.url!,
        usedPrompt: request.prompt,
        elapsedMs: stepDuration
      };
    } else {
      processingLog.steps.push({
        step: 'ai_generation',
        status: 'failure',
        duration: stepDuration,
        error: aiResult.error
      });

      return {
        success: false,
        source: 'emergency-fallback',
        url: config.defaults.imageUrl,
        usedPrompt: request.prompt,
        elapsedMs: stepDuration,
        error: aiResult.error,
        details: {
          aiGenerationError: aiResult.error
        }
      };
    }

  } catch (error) {
    const stepDuration = Date.now() - stepStartTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown AI generation error';

    processingLog.steps.push({
      step: 'ai_generation',
      status: 'failure',
      duration: stepDuration,
      error: errorMessage
    });

    return {
      success: false,
      source: 'emergency-fallback',
      url: config.defaults.imageUrl,
      usedPrompt: request.prompt,
      elapsedMs: stepDuration,
      error: errorMessage,
      details: {
        aiGenerationError: errorMessage
      }
    };
  }
}

/**
 * AI图片生成（使用现有的三级fallback逻辑）
 */
async function generateImageWithFallback(
  request: GenerateImageRequest,
  env: Env,
  config: AppConfig,
  baseUrl: string
): Promise<{ success: boolean; url?: string; provider: string; error?: string }> {
  
  // 如果指定了特定提供商
  if (request.provider) {
    console.log(`Using specified provider: ${request.provider}`);
    
    switch (request.provider) {
      case 'replicate':
        return await generateWithReplicate(request, env, Date.now(), baseUrl);
      case 'fal':
        return await generateWithFal(request, env, Date.now());
      case 'unsplash':
        return await generateWithUnsplash(request, env, Date.now());
      default:
        return await generateWithUnsplash(request, env, Date.now());
    }
  }

  // 三级fallback: Replicate → Fal → Unsplash
  console.log('Starting AI generation with fallback: Replicate → Fal → Unsplash');

  // 1. 尝试Replicate
  try {
    console.log('Trying Replicate AI...');
    const replicateResult = await Promise.race([
      generateWithReplicate(request, env, Date.now(), baseUrl),
      new Promise<any>((_, reject) =>
        setTimeout(() => reject(new Error('Replicate timeout')), 25000)
      )
    ]);

    if (replicateResult.success) {
      console.log('Replicate AI succeeded');
      return replicateResult;
    }
  } catch (error) {
    console.log('Replicate AI failed:', error);
  }

  // 2. 尝试Fal
  try {
    console.log('Trying Fal AI...');
    const falResult = await Promise.race([
      generateWithFal(request, env, Date.now()),
      new Promise<any>((_, reject) =>
        setTimeout(() => reject(new Error('Fal timeout')), 12000)
      )
    ]);

    if (falResult.success) {
      console.log('Fal AI succeeded');
      return falResult;
    }
  } catch (error) {
    console.log('Fal AI failed:', error);
  }

  // 3. 最后尝试Unsplash
  try {
    console.log('Falling back to Unsplash...');
    const unsplashResult = await generateWithUnsplash(request, env, Date.now());
    return unsplashResult;
  } catch (error) {
    console.error('All providers failed:', error);
    return {
      success: false,
      provider: 'emergency-fallback',
      error: 'All AI providers failed'
    };
  }
}

/**
 * 存储图片到R2
 */
async function storeToR2(
  imageUrl: string,
  articleId: string | undefined,
  env: Env,
  baseUrl: string,
  processingLog: ProcessingLog
): Promise<{ success: boolean; url?: string; error?: string }> {
  const stepStartTime = Date.now();

  try {
    console.log(`Storing image to R2: ${imageUrl}`);

    const r2Url = await uploadToR2(imageUrl, env, {
      r2: {
        pathPrefix: articleId ? `articles/${articleId}` : 'ai',
        cacheControl: 'public, max-age=31536000, immutable',
        customDomain: env.R2_CUSTOM_DOMAIN
      }
    } as any);

    const stepDuration = Date.now() - stepStartTime;

    processingLog.steps.push({
      step: 'r2_storage',
      status: 'success',
      duration: stepDuration,
      details: {
        originalUrl: imageUrl,
        r2Url: r2Url,
        articleId: articleId
      }
    });

    console.log(`Image stored to R2 successfully: ${r2Url}`);
    return { success: true, url: r2Url };

  } catch (error) {
    const stepDuration = Date.now() - stepStartTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown R2 storage error';

    processingLog.steps.push({
      step: 'r2_storage',
      status: 'failure',
      duration: stepDuration,
      error: errorMessage
    });

    console.error(`R2 storage failed: ${errorMessage}`);
    return { success: false, error: errorMessage };
  }
}

/**
 * 记录处理日志到KV
 */
async function recordProcessingLog(log: ProcessingLog, env: Env): Promise<void> {
  try {
    const logKey = `processing_log:${log.requestId}`;
    await env.STATE_KV.put(logKey, JSON.stringify(log), {
      expirationTtl: 24 * 60 * 60 // 24小时过期
    });
    console.log(`Processing log recorded: ${log.requestId}`);
  } catch (error) {
    console.error('Failed to record processing log:', error);
    // 不抛出错误，避免影响主流程
  }
}

/**
 * 生成请求ID
 */
function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${timestamp}-${random}`;
}

/**
 * 创建成功响应
 */
function createSuccessResponse(
  result: ImageProcessingResult,
  startTime: number
): UnifiedImageResponse {
  return {
    url: result.url,
    source: result.source,
    elapsedMs: Date.now() - startTime,
    success: result.success,
    r2Stored: true, // 假设成功时都已存储到R2
    originalUrl: result.originalUrl,
    usedPrompt: result.usedPrompt
  };
}

/**
 * 创建错误响应
 */
function createErrorResponse(
  error: string,
  startTime: number,
  processingLog: ProcessingLog
): UnifiedImageResponse {
  return {
    url: processingLog.finalResult.url, // 使用emergency fallback URL
    source: 'emergency-fallback',
    elapsedMs: Date.now() - startTime,
    success: false,
    r2Stored: false,
    error: error,
    details: {
      originalUrlError: processingLog.steps.find(s => s.step === 'url_validation' && s.status === 'failure')?.error,
      aiGenerationError: processingLog.steps.find(s => s.step === 'ai_generation' && s.status === 'failure')?.error,
      r2StorageError: processingLog.steps.find(s => s.step === 'r2_storage' && s.status === 'failure')?.error
    }
  };
}
