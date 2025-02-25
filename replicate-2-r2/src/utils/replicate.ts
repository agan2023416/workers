type PredictionStatus = 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';

interface ReplicatePrediction {
  id: string;
  status: PredictionStatus;
  error?: string;
  urls?: {
    get: string;
    cancel: string;
  };
}

interface ReplicateClientOptions {
  auth: string;
}

interface CreatePredictionOptions {
  model: string;
  input: { [key: string]: any };
  webhook?: string;
  webhook_events_filter?: string[];
}

interface ReplicateError {
  detail?: string;
}

interface ReplicateResponse {
  id: string;
  status: string;
  error?: string;
  urls?: {
    get: string;
    cancel: string;
  };
}

function isReplicateResponse(data: unknown): data is ReplicateResponse {
  if (typeof data !== 'object' || data === null) return false;
  const response = data as Record<string, unknown>;
  return typeof response.id === 'string' && typeof response.status === 'string';
}

export class ReplicateClient {
  private apiKey: string;
  private baseUrl = 'https://api.replicate.com/v1';

  constructor(options: ReplicateClientOptions) {
    this.apiKey = options.auth;
  }

  predictions = {
    create: async (options: CreatePredictionOptions): Promise<ReplicatePrediction> => {
      const response = await fetch(`${this.baseUrl}/models/${options.model}/predictions`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: options.input,
          webhook: options.webhook,
          webhook_events_filter: options.webhook_events_filter,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json() as ReplicateError;
        throw new Error(errorData.detail || 'Failed to create prediction');
      }

      const data = await response.json();
      
      if (!isReplicateResponse(data)) {
        throw new Error('Invalid response from Replicate API');
      }

      return {
        id: data.id,
        status: data.status as PredictionStatus,
        error: data.error,
        urls: data.urls
      };
    },

    get: async (url: string): Promise<ReplicatePrediction> => {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Token ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json() as ReplicateError;
        throw new Error(errorData.detail || 'Failed to get prediction');
      }

      const data = await response.json();
      
      if (!isReplicateResponse(data)) {
        throw new Error('Invalid response from Replicate API');
      }

      return {
        id: data.id,
        status: data.status as PredictionStatus,
        error: data.error,
        urls: data.urls
      };
    },

    cancel: async (url: string): Promise<void> => {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json() as ReplicateError;
        throw new Error(errorData.detail || 'Failed to cancel prediction');
      }
    }
  };
}

export default ReplicateClient;