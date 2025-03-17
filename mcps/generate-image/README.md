# Generate Image MCP Server

A Model Context Protocol (MCP) server that interfaces with the [replicate-2-r2](../replicate-2-r2) Cloudflare Worker to provide AI image generation capabilities.

## Features

- Seamless integration with replicate-2-r2 worker
- Asynchronous image generation support
- Real-time status feedback
- Type-safe API calls
- Comprehensive error handling

## Installation

```bash
npm install
```

## Configuration

Before running the server, set up the following environment variables:

```bash
WORKER_API_TOKEN=your_worker_api_token
CLOUDFLARE_WORKERS_URL=your_worker_url
```

## Usage

1. Start the MCP server:
```bash
npm start
```

2. Use in MCP client:
```typescript
const result = await mcpClient.tools.generate({
    prompt: "Your image description"
});
```

## MCP Configuration Example

Add the following configuration to your `cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "generate-image": {
      "command": "node",
      "args": [
        "PATH_TO_YOUR_GENERATE_IMAGE_SERVER"
      ],
      "env": {
        "WORKER_API_TOKEN": "YOUR_WORKER_API_TOKEN",
        "CLOUDFLARE_WORKERS_URL": "YOUR_WORKER_URL"
      },
      "disabled": false,
      "alwaysAllow": []
    }
  }
}
```

## Development

```bash
# Development mode
npm run dev

# Type checking
npm run type-check
```

## Project Structure

```
generate-image/
├── src/
│   └── index.ts      # Main server implementation
├── package.json      # Project dependencies
├── tsconfig.json     # TypeScript configuration
└── README.md         # Project documentation
```

## Integration with replicate-2-r2

This MCP server serves as a client interface for the replicate-2-r2 worker, providing:

1. Image generation request submission
2. Generation status updates
3. Generated image URL retrieval

For detailed workflow information, please refer to the [replicate-2-r2 documentation](../replicate-2-r2/README.md#mcp-integration). 