#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { 
  CallToolRequestSchema, 
  ListToolsRequestSchema, 
  CallToolRequest,
  ErrorCode,
  McpError 
} from '@modelcontextprotocol/sdk/types.js';

// 环境变量配置
const WORKER_URL = process.env.CLOUDFLARE_WORKERS_URL || 'https://your-worker.workers.dev';
const WORKER_API_TOKEN = process.env.WORKER_API_TOKEN || '';

// 验证环境变量
if (!WORKER_URL || !WORKER_API_TOKEN) {
  console.error('❌ 缺少必要的环境变量:');
  console.error('  CLOUDFLARE_WORKERS_URL - Cloudflare Worker URL');
  console.error('  WORKER_API_TOKEN - Worker API Token');
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

class N8nImageMCPServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: 'n8n-image-generator',
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
      // 为n8n生成webhook URL（如果需要）
      webhook: `${WORKER_URL}/webhook`,
      webhookEvents: ["completed", "failed"]
    };

    try {
      console.error(`🎨 开始生成图像: "${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}"`);
      
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

      console.error(`✅ 图像生成任务已创建 - ID: ${result.id}`);

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
      // 这里可以扩展为实际的状态查询API
      // 目前返回提示信息
      return {
        content: [
          {
            type: 'text',
            text: `📊 **图像生成状态查询**\n\n🔍 预测ID: \`${predictionId}\`\n\n💡 **状态说明:**\n- 图像生成任务通常需要 10-60 秒完成\n- 完成后图像会自动存储到 Cloudflare R2\n- 可以直接访问返回的图像URL查看结果\n\n🔗 **检查方法:**\n1. 访问生成时返回的图像URL\n2. 如果图像可访问，说明生成已完成\n3. 如果无法访问，说明仍在生成中`
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

⏱️ **预计完成时间:** 10-60秒

💡 **说明:**
- 图像正在后台生成中，请稍等片刻
- 生成完成后可直接访问上述URL查看图像
- 如需查询状态，请使用 \`get_generation_status\` 工具`;
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

  private setupErrorHandling() {
    this.server.onerror = (error: Error) => {
      console.error('[MCP服务器错误]:', error);
    };

    process.on('SIGINT', async () => {
      console.error('\n🛑 正在关闭MCP服务器...');
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
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      
      console.error('🚀 n8n图像生成MCP服务器已启动');
      console.error(`📡 连接到Worker: ${WORKER_URL}`);
      console.error('🎯 可用工具: generate_image, get_generation_status');
      console.error('');
      console.error('✨ 准备接收n8n的图像生成请求...');
    } catch (error) {
      console.error('❌ 服务器启动失败:', error);
      process.exit(1);
    }
  }
}

// 启动服务器
const server = new N8nImageMCPServer();
server.start().catch((error) => {
  console.error('启动失败:', error);
  process.exit(1);
}); 