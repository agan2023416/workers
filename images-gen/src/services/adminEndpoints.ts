import { Env } from '@/types';
import { getConfig, updateConfig } from '@/config';
import { getAggregatedStats, getDailyStats } from '@/services/stateTracker';
import { getStorageStats } from '@/services/r2Storage';
import { SecretsManager, EnvironmentValidator } from '@/utils/secretsManager';
import { globalCircuitBreaker } from '@/utils/errorHandler';
import { createSuccessResponse, createErrorResponse } from '@/utils/response';

/**
 * Handle admin/management endpoints
 */
export async function handleAdminRequest(
  request: Request,
  env: Env,
  path: string
): Promise<Response> {
  // Basic authentication check (in production, use proper auth)
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !isValidAdminAuth(authHeader, env)) {
    return createErrorResponse('Unauthorized', 401);
  }

  const url = new URL(request.url);
  const method = request.method;

  switch (path) {
    case '/admin/status':
      return await handleStatusEndpoint(env);
    
    case '/admin/config':
      return await handleConfigEndpoint(request, env, method);
    
    case '/admin/stats':
      return await handleStatsEndpoint(url, env);
    
    case '/admin/providers':
      return await handleProvidersEndpoint(env);
    
    case '/admin/storage':
      return await handleStorageEndpoint(env);
    
    case '/admin/circuit-breaker':
      return await handleCircuitBreakerEndpoint(request, env, method);
    
    default:
      return createErrorResponse('Admin endpoint not found', 404);
  }
}

/**
 * Handle status endpoint
 */
async function handleStatusEndpoint(env: Env): Promise<Response> {
  const validator = new EnvironmentValidator(env);
  const secretsManager = new SecretsManager(env);
  
  const [
    envValidation,
    credentialsStatus,
    config,
  ] = await Promise.all([
    Promise.resolve(validator.validateEnvironment()),
    secretsManager.getCredentialsStatus(),
    getConfig(env),
  ]);

  const status = {
    environment: env.ENVIRONMENT,
    timestamp: new Date().toISOString(),
    validation: envValidation,
    credentials: credentialsStatus,
    config: {
      providersEnabled: Object.entries(config.providers)
        .filter(([, cfg]) => cfg.enabled)
        .map(([name]) => name),
    },
    health: {
      overall: envValidation.isValid && credentialsStatus.valid > 0 ? 'healthy' : 'degraded',
      details: {
        environment: envValidation.isValid ? 'ok' : 'error',
        credentials: credentialsStatus.valid > 0 ? 'ok' : 'error',
        providers: credentialsStatus.valid,
      },
    },
  };

  return createSuccessResponse(status);
}

/**
 * Handle config endpoint
 */
async function handleConfigEndpoint(
  request: Request,
  env: Env,
  method: string
): Promise<Response> {
  if (method === 'GET') {
    const config = await getConfig(env);
    return createSuccessResponse(config);
  }

  if (method === 'PUT' || method === 'PATCH') {
    try {
      const updates = await request.json();
      await updateConfig(env, updates);
      const newConfig = await getConfig(env);
      return createSuccessResponse(newConfig);
    } catch (error) {
      return createErrorResponse(
        `Failed to update config: ${error instanceof Error ? error.message : 'Unknown error'}`,
        400
      );
    }
  }

  return createErrorResponse('Method not allowed', 405);
}

/**
 * Handle stats endpoint
 */
async function handleStatsEndpoint(url: URL, env: Env): Promise<Response> {
  const days = parseInt(url.searchParams.get('days') || '7');
  const date = url.searchParams.get('date');

  if (date) {
    // Get stats for specific date
    const dailyStats = await getDailyStats(env, date);
    return createSuccessResponse(dailyStats);
  } else {
    // Get aggregated stats
    const aggregatedStats = await getAggregatedStats(env, days);
    return createSuccessResponse(aggregatedStats);
  }
}

/**
 * Handle providers endpoint
 */
async function handleProvidersEndpoint(env: Env): Promise<Response> {
  const secretsManager = new SecretsManager(env);
  const config = await getConfig(env);
  
  const [credentialsStatus] = await Promise.all([
    secretsManager.getCredentialsStatus(),
  ]);

  const providers = Object.entries(config.providers).map(([name, providerConfig]) => {
    const circuitStatus = globalCircuitBreaker.getProviderStatus(name as any);
    
    return {
      name,
      enabled: providerConfig.enabled,
      configured: secretsManager.hasValidCredentials(name as any),
      valid: credentialsStatus.providers[name as keyof typeof credentialsStatus.providers],
      circuitBreaker: circuitStatus,
      config: {
        timeout: providerConfig.timeout,
        retries: providerConfig.retries,
        priority: providerConfig.priority,
      },
    };
  });

  return createSuccessResponse({
    providers,
    summary: {
      total: providers.length,
      enabled: providers.filter(p => p.enabled).length,
      configured: providers.filter(p => p.configured).length,
      healthy: providers.filter(p => p.circuitBreaker.status === 'healthy').length,
    },
  });
}

/**
 * Handle storage endpoint
 */
async function handleStorageEndpoint(env: Env): Promise<Response> {
  try {
    const storageStats = await getStorageStats(env);
    return createSuccessResponse(storageStats);
  } catch (error) {
    return createErrorResponse(
      `Failed to get storage stats: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500
    );
  }
}

/**
 * Handle circuit breaker endpoint
 */
async function handleCircuitBreakerEndpoint(
  request: Request,
  _env: Env,
  method: string
): Promise<Response> {
  if (method === 'GET') {
    const providers = ['replicate', 'fal', 'unsplash'] as const;
    const status = providers.reduce((acc, provider) => {
      acc[provider] = globalCircuitBreaker.getProviderStatus(provider);
      return acc;
    }, {} as Record<string, any>);

    return createSuccessResponse(status);
  }

  if (method === 'POST') {
    try {
      const { action, provider } = await request.json();
      
      if (action === 'reset' && provider) {
        // Reset specific provider
        globalCircuitBreaker.recordSuccess(provider);
        return createSuccessResponse({ message: `Circuit breaker reset for ${provider}` });
      }
      
      if (action === 'reset-all') {
        // Reset all providers
        ['replicate', 'fal', 'unsplash'].forEach(p => {
          globalCircuitBreaker.recordSuccess(p as any);
        });
        return createSuccessResponse({ message: 'All circuit breakers reset' });
      }
      
      return createErrorResponse('Invalid action', 400);
    } catch (error) {
      return createErrorResponse('Invalid request body', 400);
    }
  }

  return createErrorResponse('Method not allowed', 405);
}

/**
 * Basic admin authentication (replace with proper auth in production)
 */
function isValidAdminAuth(authHeader: string, _env: Env): boolean {
  // In production, implement proper authentication
  // For now, just check for a basic token
  const token = authHeader.replace('Bearer ', '');

  // You could store admin tokens in KV or use a more sophisticated auth system
  const validTokens = ['admin-dev-token-123']; // Replace with secure tokens

  return validTokens.includes(token);
}
