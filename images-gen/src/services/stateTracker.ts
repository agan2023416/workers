import { Env, GenerationState, ImageProvider } from '@/types';

/**
 * Record generation state to KV storage
 */
export async function recordState(env: Env, state: GenerationState): Promise<void> {
  try {
    const key = `state:${state.id}`;
    const value = JSON.stringify(state);
    
    // Store with 30 days TTL
    const ttl = 30 * 24 * 60 * 60; // 30 days in seconds
    await env.STATE_KV.put(key, value, { expirationTtl: ttl });
    
    // Also store in daily aggregation for statistics
    await updateDailyStats(env, state);
    
    console.log(`Recorded state: ${state.id} (${state.provider}, ${state.success ? 'success' : 'failure'})`);
  } catch (error) {
    console.error('Failed to record state:', error);
    // Don't throw - state recording should not break the main flow
  }
}

/**
 * Get generation state by ID
 */
export async function getState(env: Env, id: string): Promise<GenerationState | null> {
  try {
    const key = `state:${id}`;
    const value = await env.STATE_KV.get(key);
    
    if (!value) {
      return null;
    }
    
    return JSON.parse(value) as GenerationState;
  } catch (error) {
    console.error('Failed to get state:', error);
    return null;
  }
}

/**
 * Update daily statistics
 */
async function updateDailyStats(env: Env, state: GenerationState): Promise<void> {
  try {
    const dateStr = new Date(state.createdAt).toISOString().split('T')[0]; // YYYY-MM-DD
    if (!dateStr) {
      throw new Error('Invalid date format');
    }

    const statsKey = `stats:daily:${dateStr}`;

    // Get existing stats
    const existingStatsJson = await env.STATE_KV.get(statsKey);
    let stats: DailyStats;

    if (existingStatsJson) {
      stats = JSON.parse(existingStatsJson);
    } else {
      stats = {
        date: dateStr,
        total: 0,
        successful: 0,
        failed: 0,
        providers: {
          replicate: { total: 0, successful: 0, failed: 0, avgElapsedMs: 0, totalElapsedMs: 0 },
          fal: { total: 0, successful: 0, failed: 0, avgElapsedMs: 0, totalElapsedMs: 0 },
          unsplash: { total: 0, successful: 0, failed: 0, avgElapsedMs: 0, totalElapsedMs: 0 },
          default: { total: 0, successful: 0, failed: 0, avgElapsedMs: 0, totalElapsedMs: 0 },
        },
        avgElapsedMs: 0,
        totalElapsedMs: 0,
      };
    }
    
    // Update stats
    stats.total++;
    if (state.success) {
      stats.successful++;
    } else {
      stats.failed++;
    }
    
    // Update provider stats
    if (!stats.providers[state.provider]) {
      stats.providers[state.provider] = {
        total: 0,
        successful: 0,
        failed: 0,
        avgElapsedMs: 0,
        totalElapsedMs: 0,
      };
    }
    
    const providerStats = stats.providers[state.provider];
    providerStats.total++;
    if (state.success) {
      providerStats.successful++;
    } else {
      providerStats.failed++;
    }
    
    // Update timing stats
    stats.totalElapsedMs += state.elapsedMs;
    stats.avgElapsedMs = stats.totalElapsedMs / stats.total;
    
    providerStats.totalElapsedMs += state.elapsedMs;
    providerStats.avgElapsedMs = providerStats.totalElapsedMs / providerStats.total;
    
    // Store updated stats with 90 days TTL
    const ttl = 90 * 24 * 60 * 60; // 90 days in seconds
    await env.STATE_KV.put(statsKey, JSON.stringify(stats), { expirationTtl: ttl });
  } catch (error) {
    console.error('Failed to update daily stats:', error);
  }
}

/**
 * Get daily statistics
 */
export async function getDailyStats(env: Env, date: string): Promise<DailyStats | null> {
  try {
    const statsKey = `stats:daily:${date}`;
    const statsJson = await env.STATE_KV.get(statsKey);
    
    if (!statsJson) {
      return null;
    }
    
    return JSON.parse(statsJson) as DailyStats;
  } catch (error) {
    console.error('Failed to get daily stats:', error);
    return null;
  }
}

/**
 * Get statistics for a date range
 */
export async function getStatsRange(
  env: Env,
  startDate: string,
  endDate: string
): Promise<DailyStats[]> {
  const stats: DailyStats[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    const dateStr = date.toISOString().split('T')[0];
    if (dateStr) {
      const dailyStats = await getDailyStats(env, dateStr);

      if (dailyStats) {
        stats.push(dailyStats);
      }
    }
  }
  
  return stats;
}

/**
 * Get aggregated statistics
 */
export async function getAggregatedStats(
  env: Env,
  days: number = 7
): Promise<AggregatedStats> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days + 1);
  
  const startDateStr = startDate.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  if (!startDateStr || !endDateStr) {
    throw new Error('Invalid date range');
  }

  const dailyStats = await getStatsRange(env, startDateStr, endDateStr);
  
  const aggregated: AggregatedStats = {
    period: `${startDateStr} to ${endDateStr}`,
    total: 0,
    successful: 0,
    failed: 0,
    successRate: 0,
    providers: {
      replicate: { total: 0, successful: 0, failed: 0, successRate: 0, avgElapsedMs: 0 },
      fal: { total: 0, successful: 0, failed: 0, successRate: 0, avgElapsedMs: 0 },
      unsplash: { total: 0, successful: 0, failed: 0, successRate: 0, avgElapsedMs: 0 },
      default: { total: 0, successful: 0, failed: 0, successRate: 0, avgElapsedMs: 0 },
    },
    avgElapsedMs: 0,
    dailyBreakdown: dailyStats,
  };
  
  let totalElapsedMs = 0;
  
  dailyStats.forEach(stats => {
    aggregated.total += stats.total;
    aggregated.successful += stats.successful;
    aggregated.failed += stats.failed;
    totalElapsedMs += stats.totalElapsedMs;
    
    // Aggregate provider stats
    Object.entries(stats.providers).forEach(([provider, providerStats]) => {
      if (!aggregated.providers[provider as ImageProvider]) {
        aggregated.providers[provider as ImageProvider] = {
          total: 0,
          successful: 0,
          failed: 0,
          successRate: 0,
          avgElapsedMs: 0,
        };
      }
      
      const aggProviderStats = aggregated.providers[provider as ImageProvider];
      aggProviderStats.total += providerStats.total;
      aggProviderStats.successful += providerStats.successful;
      aggProviderStats.failed += providerStats.failed;
    });
  });
  
  // Calculate rates and averages
  if (aggregated.total > 0) {
    aggregated.successRate = (aggregated.successful / aggregated.total) * 100;
    aggregated.avgElapsedMs = totalElapsedMs / aggregated.total;
  }
  
  Object.values(aggregated.providers).forEach(providerStats => {
    if (providerStats.total > 0) {
      providerStats.successRate = (providerStats.successful / providerStats.total) * 100;
    }
  });
  
  return aggregated;
}

/**
 * Get recent failures for debugging
 */
export async function getRecentFailures(
  _env: Env,
  _limit: number = 10
): Promise<GenerationState[]> {
  try {
    // This is a simplified implementation
    // In a real scenario, you might want to maintain a separate index for failures
    const failures: GenerationState[] = [];

    // For now, return empty array as we'd need a more complex indexing strategy
    // to efficiently query recent failures from KV
    return failures;
  } catch (error) {
    console.error('Failed to get recent failures:', error);
    return [];
  }
}

// Type definitions for statistics
interface DailyStats {
  date: string;
  total: number;
  successful: number;
  failed: number;
  providers: Record<ImageProvider, ProviderDailyStats>;
  avgElapsedMs: number;
  totalElapsedMs: number;
}

interface ProviderDailyStats {
  total: number;
  successful: number;
  failed: number;
  avgElapsedMs: number;
  totalElapsedMs: number;
}

interface AggregatedStats {
  period: string;
  total: number;
  successful: number;
  failed: number;
  successRate: number;
  providers: Record<ImageProvider, ProviderAggregatedStats>;
  avgElapsedMs: number;
  dailyBreakdown: DailyStats[];
}

interface ProviderAggregatedStats {
  total: number;
  successful: number;
  failed: number;
  successRate: number;
  avgElapsedMs: number;
}
