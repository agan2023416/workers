import { verifySignature } from './utils/auth';
import { generateUniqueId } from './utils/id';
import { downloadImage } from './utils/image';
import { verifyWebhookSignature } from './utils/webhook';
import { ReplicateClient } from './utils/replicate';
import { Env, WorkerResponse, WorkerRequest, WebhookHeaders } from './types';

interface PredictionMetadata {
  predictionId: string;
  imageKey: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    // Only allow POST requests
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      // Check if this is a webhook callback from Replicate
      const webhookId = request.headers.get('webhook-id');
      const webhookTimestamp = request.headers.get('webhook-timestamp');
      const webhookSignature = request.headers.get('webhook-signature');

      if (webhookId && webhookTimestamp && webhookSignature) {
        // This is a webhook callback
        const rawBody = await request.text();
        console.log('Received webhook:', { webhookId, webhookTimestamp });
        
        // Verify webhook signature
        const isValid = await verifyWebhookSignature(
          webhookId,
          webhookTimestamp,
          webhookSignature,
          rawBody,
          env.REPLICATE_WEBHOOK_SECRET
        );

        if (!isValid) {
          console.error('Invalid webhook signature');
          return new Response('Invalid webhook signature', { status: 401 });
        }

        // Parse the webhook body
        const webhookData = JSON.parse(rawBody);
        console.log('Webhook data:', webhookData);

        // Process webhook data
        if (webhookData.status === 'succeeded' && webhookData.output && webhookData.output.length > 0) {
          // Get the image key from the metadata
          const predictionId = webhookData.id;
          const metadata = await env.BUCKET.get(`metadata/${predictionId}.json`);
          
          if (!metadata) {
            console.error('No metadata found for prediction:', predictionId);
            return new Response('Metadata not found', { status: 500 });
          }

          const { imageKey } = JSON.parse(await metadata.text()) as PredictionMetadata;
          
          console.log('Downloading image from:', webhookData.output[0]);
          console.log('Will store as:', imageKey);
          
          try {
            // Download and store the image in R2
            const imageData = await downloadImage(webhookData.output[0]);
            console.log('Image downloaded, size:', imageData.byteLength);
            
            await env.BUCKET.put(imageKey, imageData, {
              httpMetadata: {
                contentType: 'image/webp',
              },
            });
            console.log('Image stored in R2:', `${env.BUCKET_URL}/${imageKey}`);
          } catch (error) {
            console.error('Failed to store image:', error);
            return new Response('Failed to store image', { status: 500 });
          }
        } else if (webhookData.status === 'failed') {
          console.error('Prediction failed:', webhookData.error);
        }

        return new Response('OK', { status: 200 });
      }

      // Handle regular API requests
      const authHeader = request.headers.get('Authorization');
      if (!authHeader || !verifySignature(authHeader, env.WORKER_API_TOKEN)) {
        return new Response('Unauthorized', { status: 401 });
      }

      // Parse request body
      const { prompt, model, webhook, webhookEvents } = await request.json<WorkerRequest>();

      if (!prompt || !model) {
        return new Response('Missing required fields', { status: 400 });
      }

      console.log('Using R2 bucket URL:', env.BUCKET_URL);

      // Initialize Replicate client
      const replicate = new ReplicateClient({
        auth: env.REPLICATE_API_TOKEN,
      });

      // Create prediction using Replicate client
      const prediction = await replicate.predictions.create({
        model,
        input: { prompt },
        webhook,
        webhook_events_filter: webhookEvents,
      });

      console.log('Prediction created:', prediction.id);

      // Generate a unique image key
      const imageKey = `${generateUniqueId()}.webp`;

      // Store metadata for the webhook to use later
      const metadata: PredictionMetadata = {
        predictionId: prediction.id,
        imageKey,
      };

      await env.BUCKET.put(`metadata/${prediction.id}.json`, JSON.stringify(metadata), {
        httpMetadata: {
          contentType: 'application/json',
        },
      });

      const response: WorkerResponse = {
        id: prediction.id,
        imageUrl: `${env.BUCKET_URL}/${imageKey}`,
        status: prediction.status,
      };

      console.log('Response:', response);

      return new Response(JSON.stringify(response), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });

    } catch (error) {
      console.error('Worker error:', error);
      const response: WorkerResponse = {
        id: '',
        imageUrl: '',
        status: 'failed',
        error: error instanceof Error ? error.message : 'Internal Server Error',
      };
      return new Response(JSON.stringify(response), { 
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  },
};