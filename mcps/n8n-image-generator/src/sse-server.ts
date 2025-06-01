#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { 
  CallToolRequestSchema, 
  ListToolsRequestSchema, 
  CallToolRequest 
} from '@modelcontextprotocol/sdk/types.js';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { parse } from 'url';

// 环境变量配置
const WORKER_URL = process.env.CLOUDFLARE_WORKERS_URL || process.env.MCP_CLOUDFLARE_WORKERS_URL || '';
const WORKER_API_TOKEN = process.env.WORKER_API_TOKEN || process.env.MCP_WORKER_API_TOKEN || '';
const PORT = parseInt(process.env.PORT || '3000');

// 验证环境变量
if (!WORKER_URL || !WORKER_API_TOKEN) {
  console.error('❌ 缺少必要的环境变量:');
  console.error('  CLOUDFLARE_WORKERS_URL 或 MCP_CLOUDFLARE_WORKERS_URL');
  console.error('  WORKER_API_TOKEN 或 MCP_WORKER_API_TOKEN');
  process.exit(1);
}

interface ImageGenerationRequest {
  prompt: string;
  model?: string;
  version?: string;
}

interface ImageGenerationResponse {
  id: string;
  imageUrl: string;
  status: string;
}

class N8nImageSSEServer {
  private server: Server;
  private httpServer: any;

  constructor() {
    this.server = new Server(
      {
        name: 'n8n-image-generator-sse',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupTools();
    this.setupErrorHandling();
    this.createHTTPServer();
  }

  private setupTools() {
    // 列出可用工具
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'generate_image',
            description: '使用AI生成图像并存储到Cloudflare R2。支持多种AI模型，返回可访问的图像URL。',
            inputSchema: {
              type: 'object',
              properties: {
                prompt: {
                  type: 'string',
                  description: '图像生成的提示词，描述你想要生成的图像内容'
                },
                model: {
                  type: 'string',
                  description: '使用的AI模型',
                  default: 'black-forest-labs/flux-schnell',
                  enum: [
                    'black-forest-labs/flux-schnell',
                    'black-forest-labs/flux-dev',
                    'stability-ai/stable-diffusion-xl-base-1.0'
                  ]
                },
                version: {
                  type: 'string',
                  description: '模型的特定版本ID（可选，通常使用默认版本）'
                }
              },
              required: ['prompt']
            }
          },
          {
            name: 'get_generation_status',
            description: '查询图像生成任务的状态',
            inputSchema: {
              type: 'object',
              properties: {
                predictionId: {
                  type: 'string',
                  description: '图像生成任务的预测ID'
                }
              },
              required: ['predictionId']
            }
          }
        ]
      };
    });

    // 执行工具
    this.server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'generate_image':
            return await this.handleGenerateImage(args as unknown as ImageGenerationRequest);
          case 'get_generation_status':
            return await this.handleGetGenerationStatus(args as unknown as { predictionId: string });
          default:
            throw new Error(`未知工具: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`工具执行失败: ${errorMessage}`);
      }
    });
  }

  private async handleGenerateImage(args: ImageGenerationRequest) {
    const { prompt, model = 'black-forest-labs/flux-schnell', version } = args;

    if (!prompt || prompt.trim().length === 0) {
      throw new Error('提示词不能为空');
    }

    // 构建请求体
    const requestBody: any = {
      prompt: prompt.trim(),
      model,
      ...(version && { version }),
      webhook: `${WORKER_URL}/webhook`,
      webhookEvents: ["completed", "output"]
    };

    try {
      console.log(`🎨 开始生成图像: "${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}"`);
      
      // 调用Cloudflare Worker
      const response = await fetch(WORKER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${WORKER_API_TOKEN}`,
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch {
          errorData = { error: `HTTP ${response.status} ${response.statusText}` };
        }
        throw new Error(errorData.error || `Worker请求失败: ${response.status}`);
      }

      const result: ImageGenerationResponse = await response.json();

      console.log(`✅ 图像生成任务已创建 - ID: ${result.id}`);

      // 返回格式化的结果
      return {
        content: [
          {
            type: 'text',
            text: this.formatGenerationResult(result, prompt, model)
          }
        ]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ 图像生成失败: ${errorMessage}`);
      throw new Error(`图像生成失败: ${errorMessage}`);
    }
  }

  private async handleGetGenerationStatus(args: { predictionId: string }) {
    const { predictionId } = args;

    if (!predictionId) {
      throw new Error('预测ID不能为空');
    }

    try {
      return {
        content: [
          {
            type: 'text',
            text: `📊 **图像生成状态查询**\n\n🔍 预测ID: \`${predictionId}\`\n\n💡 **状态说明:**\n- 图像生成任务通常需要 10-60 秒完成\n- 完成后图像会自动存储到 Cloudflare R2\n- 可以直接访问返回的图像URL查看结果`
          }
        ]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`状态查询失败: ${errorMessage}`);
    }
  }

  private formatGenerationResult(result: ImageGenerationResponse, prompt: string, model: string): string {
    return `🎨 **图像生成任务已启动**

📋 **任务信息:**
- **预测ID:** \`${result.id}\`
- **状态:** ${this.getStatusEmoji(result.status)} ${result.status}
- **模型:** ${model}
- **提示词:** "${prompt}"

🔗 **图像URL:** ${result.imageUrl}

⏱️ **预计完成时间:** 10-60秒`;
  }

  private getStatusEmoji(status: string): string {
    const statusEmojis: Record<string, string> = {
      'starting': '🚀',
      'processing': '⏳',
      'succeeded': '✅',
      'failed': '❌',
      'canceled': '⏹️'
    };
    return statusEmojis[status] || '❓';
  }

  private createHTTPServer() {
    this.httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const parsedUrl = parse(req.url || '', true);
      
      // 处理 CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      // 处理 SSE 连接
      if (parsedUrl.pathname === '/sse' && req.method === 'GET') {
        try {
          const transport = new SSEServerTransport(req.url || '/sse', res);
          await this.server.connect(transport);
          console.log('🔗 新的SSE连接已建立');
        } catch (error) {
          console.error('❌ SSE连接失败:', error);
          res.writeHead(500);
          res.end('Internal Server Error');
        }
      } else if (parsedUrl.pathname === '/health') {
        // 健康检查端点
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          status: 'healthy', 
          service: 'n8n-image-generator-sse',
          timestamp: new Date().toISOString()
        }));
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });
  }

  private setupErrorHandling() {
    this.server.onerror = (error: Error) => {
      console.error('[MCP SSE服务器错误]:', error);
    };

    process.on('SIGINT', async () => {
      console.log('\n🛑 正在关闭SSE服务器...');
      this.httpServer.close();
      await this.server.close();
      process.exit(0);
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('未处理的Promise拒绝:', reason);
    });

    process.on('uncaughtException', (error) => {
      console.error('未捕获的异常:', error);
      process.exit(1);
    });
  }

  async start() {
    try {
      this.httpServer.listen(PORT, () => {
        console.log('🚀 n8n图像生成SSE服务器已启动');
        console.log(`📡 SSE端点: http://localhost:${PORT}/sse`);
        console.log(`❤️ 健康检查: http://localhost:${PORT}/health`);
        console.log(`🔗 连接到Worker: ${WORKER_URL}`);
        console.log('🎯 可用工具: generate_image, get_generation_status');
        console.log('');
        console.log('✨ 准备接收n8n的SSE连接...');
      });
    } catch (error) {
      console.error('❌ SSE服务器启动失败:', error);
      process.exit(1);
    }
  }
}

// 启动SSE服务器
const sseServer = new N8nImageSSEServer();
sseServer.start().catch((error) => {
  console.error('启动失败:', error);
  process.exit(1);
}); 