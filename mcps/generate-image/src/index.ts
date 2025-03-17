import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Initialize the server
const server = new McpServer({
    name: 'Replicate Image Generator',
    version: '1.0.0',
});

// Basic tool registration
server.tool(
    'generate',
    'Generate image using Flux model',
    {
        prompt: z.string().describe('The prompt for the image'),
    },
    async ({ prompt }) => {
        try {
            const timestamp = Date.now();
            const slug = `img-${timestamp}`;

            // Call the Worker API
            const workerResponse = await fetch(`${process.env.CLOUDFLARE_WORKERS_URL}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.WORKER_API_TOKEN}`,
                },
                body: JSON.stringify({
                    prompt: prompt,
                    model: "black-forest-labs/flux-schnell",
                    webhook: `${process.env.CLOUDFLARE_WORKERS_URL}`,
                    webhookEvents: ["completed"]
                })
            });

            if (!workerResponse.ok) {
                const error = await workerResponse.json();
                throw new Error(error.error || 'Worker API error');
            }

            const result = await workerResponse.json();

            // Return the result
            return {
                content: [{
                    type: 'text' as const,
                    text: `Generation started!\nPrediction ID: ${result.id}\nImage URL: ${result.imageUrl}\nStatus: ${result.status}`
                }]
            };
        } catch (error) {
            console.error('Error:', error);
            throw error;
        }
    }
);

// Start the server
const transport = new StdioServerTransport();
server.connect(transport).catch(error => {
    console.error('Server error:', error);
    process.exit(1);
});
