# Cloudflare Workers Collection

This repository contains a collection of specialized Cloudflare Workers and related tools, each designed to provide specific functionality and services.

## Available Projects

### [replicate-2-r2](./replicate-2-r2)
A worker that integrates Replicate's AI image generation with Cloudflare R2 storage. This worker:
- Generates images using Replicate's API
- Stores generated images in Cloudflare R2
- Provides immediate URL generation
- Supports webhook notifications
- Includes MCP server integration for seamless AI tooling

👉 [Learn more about replicate-2-r2](./replicate-2-r2)

### [generate-image](./mcps/generate-image)
A Model Context Protocol (MCP) server that provides a simple interface to the replicate-2-r2 worker. This server:
- Interfaces with replicate-2-r2 worker
- Provides type-safe API calls
- Handles asynchronous image generation
- Supports real-time status updates

👉 [Learn more about generate-image](./mcps/generate-image)

## Getting Started

Each project is contained in its own directory with its own documentation. To get started:

1. Choose the project you want to use
2. Navigate to its directory
3. Follow the setup instructions in its README.md

## Repository Structure

```
cloudflare-workers/
├── README.md
├── replicate-2-r2/         # Replicate integration worker
│   ├── README.md           # Worker-specific documentation
│   ├── src/                # Source code
│   └── ...                 # Other worker files
└── mcps/                   # MCP servers
    └── generate-image/     # Generate image MCP server
        ├── README.md       # Server documentation
        ├── src/           # Source code
        └── ...            # Other server files
```

More projects will be added to this collection in the future. Stay tuned for updates!