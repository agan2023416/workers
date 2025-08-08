# Frontend Integration Guide (Images Generation Worker)

A minimal guide for frontend developers to call the Images Generation Worker and render the returned image.

## Endpoint

- POST https://<your-worker-domain>/images/generate
- CORS is enabled (Access-Control-Allow-Origin: *)

## Authentication

- Required: Authorization header with a Worker API key
- Header: `Authorization: Bearer <API_KEY>`

## Request Body

- Required
  - `prompt` (string): The text description for image generation

- Optional
  - `provider` (string): One of `replicate` | `fal` | `unsplash`
    - If omitted, the worker uses priority racing: Replicate → Fal → Unsplash
  - `articleId` (string): If provided, the image is stored under `articles/{articleId}/...` in R2 for easier organization. If omitted, the key is `ai/YYYY/MM/...`.

Example:

```
{
  "prompt": "A cozy cabin in a snowy forest, golden hour lighting",
  "provider": "replicate",
  "articleId": "my-article-123"
}
```

## Response Body

- `url` (string):
  - If the worker is configured with `R2_CUSTOM_DOMAIN`, this is a public static CDN URL like `https://cdn.example.com/ai/YYYY/MM/uuid.webp`.
  - Otherwise, it may be a Worker proxy URL `.../images/r2?key=...`.
- `provider` (string): The provider used
- `elapsedMs` (number): Total elapsed milliseconds
- `success` (boolean)
- `r2Stored` (boolean, optional): Present when the worker stores to R2 in-path
- `error` (string, optional): Error details when `success` is false

Example (success):

```
{
  "url": "https://cdn.example.com/ai/2025/08/uuid.webp",
  "provider": "replicate",
  "elapsedMs": 2431,
  "success": true,
  "r2Stored": true
}
```

Example (failure):

```
{
  "url": "https://via.placeholder.com/1024x768/4A90E2/FFFFFF?text=Default+Image",
  "provider": "default",
  "elapsedMs": 30000,
  "success": false,
  "error": "All providers failed"
}
```

## Usage Snippet (Fetch)

```
const resp = await fetch('https://<worker-domain>/images/generate', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <API_KEY>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    prompt: 'A cozy cabin in a snowy forest, golden hour lighting',
    // provider: 'replicate',
    // articleId: 'my-article-123'
  })
});

const data = await resp.json();
if (!resp.ok || !data.success) {
  console.error('Generation failed:', data.error);
  // Fallback UI handling here
  return;
}

// Use the returned URL directly in an <img> tag
const img = document.createElement('img');
img.src = data.url; // public static URL when R2_CUSTOM_DOMAIN is set
img.alt = 'Generated image';
document.body.appendChild(img);
```

## Notes & Best Practices

- Always display the `data.url` returned by the server; do not hardcode your CDN domain on the client.
- For best UX, show a loading state and a graceful fallback image when `success` is false.
- If you pass `articleId`, you can later correlate images per article via the R2 key prefix `articles/{articleId}/...`.
- Providers have different speeds and quality; leaving `provider` empty lets the worker choose the best available provider automatically.

