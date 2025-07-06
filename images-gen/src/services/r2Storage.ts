import { Env, AppConfig } from '@/types';
import { generateR2Key, formatFileSize } from '@/utils/common';

/**
 * Upload image to R2 storage and return CDN URL
 */
export async function uploadToR2(
  imageUrl: string,
  env: Env,
  config: AppConfig
): Promise<string> {
  try {
    // Download the image
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to download image: ${imageResponse.status}`);
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
    
    // Validate image size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (imageBuffer.byteLength > maxSize) {
      throw new Error(`Image too large: ${formatFileSize(imageBuffer.byteLength)} (max: ${formatFileSize(maxSize)})`);
    }

    // Generate R2 object key
    const extension = getFileExtensionFromContentType(contentType);
    const objectKey = generateR2Key(config.r2.pathPrefix, extension);

    // Prepare metadata
    const metadata = {
      'original-url': imageUrl,
      'upload-timestamp': new Date().toISOString(),
      'content-type': contentType,
      'size': imageBuffer.byteLength.toString(),
    };

    // Upload to R2
    await env.IMAGES_BUCKET.put(objectKey, imageBuffer, {
      httpMetadata: {
        contentType,
        cacheControl: config.r2.cacheControl,
      },
      customMetadata: metadata,
    });

    // Generate CDN URL
    const cdnUrl = generateCDNUrl(objectKey, config);
    
    console.log(`Successfully uploaded image to R2: ${objectKey} (${formatFileSize(imageBuffer.byteLength)})`);
    
    return cdnUrl;
  } catch (error) {
    console.error('Failed to upload to R2:', error);
    throw new Error(`R2 upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Generate CDN URL for R2 object
 */
function generateCDNUrl(objectKey: string, config: AppConfig): string {
  // Use custom domain if configured
  if (config.r2.customDomain) {
    return `https://${config.r2.customDomain}/${objectKey}`;
  }

  // For development, we need to check if the bucket has public access configured
  // If not, we'll need to use a different approach

  // Try the standard R2 public URL format first
  // This requires the bucket to be configured for public access
  const bucketName = 'images-gen-storage-preview'; // Use preview bucket for development

  // R2 public URLs use this format when public access is enabled:
  // https://{bucket-name}.{account-id}.r2.cloudflarestorage.com/{object-key}
  // But since we don't have the account ID easily accessible, we'll use a different approach

  // For development, return a placeholder URL that indicates R2 upload was successful
  // In production, you would configure proper public access or use signed URLs
  return `https://r2-dev-placeholder.example.com/${objectKey}`;
}

/**
 * Get file extension from content type
 */
function getFileExtensionFromContentType(contentType: string): string {
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

  return typeMap[contentType.toLowerCase()] || 'jpg';
}

/**
 * Check if object exists in R2
 */
export async function objectExists(objectKey: string, env: Env): Promise<boolean> {
  try {
    const object = await env.IMAGES_BUCKET.head(objectKey);
    return object !== null;
  } catch {
    return false;
  }
}

/**
 * Delete object from R2
 */
export async function deleteFromR2(objectKey: string, env: Env): Promise<void> {
  try {
    await env.IMAGES_BUCKET.delete(objectKey);
    console.log(`Deleted object from R2: ${objectKey}`);
  } catch (error) {
    console.error(`Failed to delete object from R2: ${objectKey}`, error);
    throw error;
  }
}

/**
 * Get object metadata from R2
 */
export async function getObjectMetadata(objectKey: string, env: Env): Promise<R2Object | null> {
  try {
    return await env.IMAGES_BUCKET.head(objectKey);
  } catch (error) {
    console.error(`Failed to get object metadata: ${objectKey}`, error);
    return null;
  }
}

/**
 * List objects in R2 with prefix
 */
export async function listObjects(
  prefix: string,
  env: Env,
  limit = 100
): Promise<R2Object[]> {
  try {
    const result = await env.IMAGES_BUCKET.list({
      prefix,
      limit,
    });

    return result.objects;
  } catch (error) {
    console.error(`Failed to list objects with prefix: ${prefix}`, error);
    return [];
  }
}

/**
 * Get storage statistics
 */
export async function getStorageStats(env: Env): Promise<{
  totalObjects: number;
  totalSize: number;
  sizeByMonth: Record<string, { count: number; size: number }>;
}> {
  try {
    const objects = await listObjects('ai/', env, 1000);
    
    let totalSize = 0;
    const sizeByMonth: Record<string, { count: number; size: number }> = {};
    
    objects.forEach(obj => {
      totalSize += obj.size;
      
      // Extract year/month from key (ai/YYYY/MM/...)
      const pathParts = obj.key.split('/');
      if (pathParts.length >= 3) {
        const yearMonth = `${pathParts[1]}-${pathParts[2]}`;
        if (!sizeByMonth[yearMonth]) {
          sizeByMonth[yearMonth] = { count: 0, size: 0 };
        }
        sizeByMonth[yearMonth].count++;
        sizeByMonth[yearMonth].size += obj.size;
      }
    });
    
    return {
      totalObjects: objects.length,
      totalSize,
      sizeByMonth,
    };
  } catch (error) {
    console.error('Failed to get storage stats:', error);
    return {
      totalObjects: 0,
      totalSize: 0,
      sizeByMonth: {},
    };
  }
}

/**
 * Cleanup old objects (older than specified days)
 */
export async function cleanupOldObjects(
  env: Env,
  olderThanDays: number
): Promise<{ deleted: number; errors: number }> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
  
  let deleted = 0;
  let errors = 0;
  
  try {
    const objects = await listObjects('ai/', env, 1000);
    
    for (const obj of objects) {
      if (obj.uploaded < cutoffDate) {
        try {
          await deleteFromR2(obj.key, env);
          deleted++;
        } catch (error) {
          console.error(`Failed to delete old object: ${obj.key}`, error);
          errors++;
        }
      }
    }
  } catch (error) {
    console.error('Failed to cleanup old objects:', error);
    errors++;
  }
  
  return { deleted, errors };
}
