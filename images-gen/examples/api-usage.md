# API Usage Examples

This document provides practical examples of how to use the Images Generation Worker API.

## Basic Image Generation

### Simple Request

```javascript
const response = await fetch('https://your-worker.workers.dev/images/generate', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    prompt: 'A beautiful sunset over mountains with vibrant colors'
  })
});

const result = await response.json();
console.log('Generated image URL:', result.url);
```

### Advanced Request with Options

```javascript
const response = await fetch('https://your-worker.workers.dev/images/generate', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    prompt: 'Modern office workspace with natural lighting',
    keyword: 'office',
    articleId: 'article-123',
    width: 1920,
    height: 1080,
    style: 'professional, clean, minimalist'
  })
});

const result = await response.json();
```

## Error Handling

```javascript
async function generateImage(prompt) {
  try {
    const response = await fetch('https://your-worker.workers.dev/images/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    
    if (!result.success) {
      console.warn('Image generation failed, using fallback:', result.error);
    }
    
    return {
      url: result.url,
      provider: result.provider,
      success: result.success,
      elapsedMs: result.elapsedMs
    };
  } catch (error) {
    console.error('Failed to generate image:', error);
    throw error;
  }
}

// Usage
generateImage('A cat sitting on a windowsill')
  .then(result => {
    console.log('Image generated:', result);
  })
  .catch(error => {
    console.error('Error:', error);
  });
```

## Batch Processing

```javascript
async function generateMultipleImages(prompts) {
  const results = [];
  
  // Process in batches to avoid overwhelming the service
  const batchSize = 3;
  for (let i = 0; i < prompts.length; i += batchSize) {
    const batch = prompts.slice(i, i + batchSize);
    
    const batchPromises = batch.map(async (prompt, index) => {
      try {
        const response = await fetch('https://your-worker.workers.dev/images/generate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt,
            articleId: `batch-${i + index}`
          }),
        });
        
        const result = await response.json();
        return { prompt, ...result };
      } catch (error) {
        return { prompt, error: error.message, success: false };
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    // Add delay between batches
    if (i + batchSize < prompts.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return results;
}

// Usage
const prompts = [
  'A serene lake at dawn',
  'Bustling city street at night',
  'Cozy coffee shop interior',
  'Mountain hiking trail',
  'Modern kitchen design'
];

generateMultipleImages(prompts)
  .then(results => {
    results.forEach((result, index) => {
      if (result.success) {
        console.log(`Image ${index + 1}: ${result.url} (${result.provider})`);
      } else {
        console.log(`Image ${index + 1} failed: ${result.error}`);
      }
    });
  });
```

## React Hook Example

```jsx
import { useState, useCallback } from 'react';

function useImageGeneration() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const generateImage = useCallback(async (prompt, options = {}) => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/images/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          ...options
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setResult(data);
      
      if (!data.success) {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  return { generateImage, loading, error, result };
}

// Component usage
function ImageGenerator() {
  const [prompt, setPrompt] = useState('');
  const { generateImage, loading, error, result } = useImageGeneration();

  const handleSubmit = (e) => {
    e.preventDefault();
    if (prompt.trim()) {
      generateImage(prompt, {
        width: 1024,
        height: 768,
        style: 'photorealistic'
      });
    }
  };

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter image description..."
          disabled={loading}
        />
        <button type="submit" disabled={loading || !prompt.trim()}>
          {loading ? 'Generating...' : 'Generate Image'}
        </button>
      </form>

      {error && (
        <div style={{ color: 'red' }}>
          Error: {error}
        </div>
      )}

      {result && (
        <div>
          <img src={result.url} alt={prompt} style={{ maxWidth: '100%' }} />
          <p>
            Generated by {result.provider} in {result.elapsedMs}ms
            {!result.success && ' (fallback image)'}
          </p>
        </div>
      )}
    </div>
  );
}
```

## Node.js Server Integration

```javascript
const express = require('express');
const app = express();

app.use(express.json());

// Proxy endpoint for image generation
app.post('/api/generate-image', async (req, res) => {
  try {
    const { prompt, articleId, ...options } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const response = await fetch('https://your-worker.workers.dev/images/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        articleId: articleId || `article-${Date.now()}`,
        ...options
      }),
    });

    const result = await response.json();
    
    // Log for analytics
    console.log(`Image generated for article ${articleId}: ${result.provider} (${result.elapsedMs}ms)`);
    
    res.json(result);
  } catch (error) {
    console.error('Image generation error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      success: false 
    });
  }
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

## WordPress Plugin Integration

```php
<?php
// WordPress plugin example

function generate_article_image($prompt, $article_id = null) {
    $worker_url = 'https://your-worker.workers.dev/images/generate';
    
    $data = array(
        'prompt' => $prompt,
        'articleId' => $article_id ?: 'wp-' . get_the_ID(),
        'width' => 1200,
        'height' => 630, // Good for social media
        'style' => 'professional, blog header'
    );
    
    $response = wp_remote_post($worker_url, array(
        'headers' => array(
            'Content-Type' => 'application/json',
        ),
        'body' => json_encode($data),
        'timeout' => 45
    ));
    
    if (is_wp_error($response)) {
        error_log('Image generation failed: ' . $response->get_error_message());
        return false;
    }
    
    $body = wp_remote_retrieve_body($response);
    $result = json_decode($body, true);
    
    if (!$result || !$result['url']) {
        error_log('Invalid response from image generation service');
        return false;
    }
    
    // Log the result
    error_log("Image generated: {$result['url']} by {$result['provider']} in {$result['elapsedMs']}ms");
    
    return $result['url'];
}

// Hook into post save
add_action('save_post', function($post_id) {
    if (get_post_type($post_id) !== 'post') {
        return;
    }
    
    $post = get_post($post_id);
    if (!$post || has_post_thumbnail($post_id)) {
        return; // Skip if already has featured image
    }
    
    // Generate image based on post title and excerpt
    $prompt = $post->post_title;
    if ($post->post_excerpt) {
        $prompt .= '. ' . $post->post_excerpt;
    }
    
    $image_url = generate_article_image($prompt, $post_id);
    
    if ($image_url) {
        // Download and set as featured image
        $image_id = media_sideload_image($image_url, $post_id, $post->post_title, 'id');
        if (!is_wp_error($image_id)) {
            set_post_thumbnail($post_id, $image_id);
        }
    }
});
?>
```

## Monitoring and Analytics

```javascript
// Client-side analytics tracking
function trackImageGeneration(result, prompt) {
  // Track with your analytics service
  if (typeof gtag !== 'undefined') {
    gtag('event', 'image_generated', {
      'provider': result.provider,
      'success': result.success,
      'elapsed_ms': result.elapsedMs,
      'prompt_length': prompt.length
    });
  }
  
  // Custom analytics
  fetch('/api/analytics/image-generation', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      provider: result.provider,
      success: result.success,
      elapsedMs: result.elapsedMs,
      promptLength: prompt.length,
      timestamp: new Date().toISOString()
    })
  }).catch(console.error);
}
```

## Health Check Integration

```javascript
// Health monitoring
async function checkServiceHealth() {
  try {
    const response = await fetch('https://your-worker.workers.dev/health');
    const health = await response.json();
    
    if (health.status === 'healthy') {
      console.log('✅ Image generation service is healthy');
      return true;
    } else {
      console.warn('⚠️ Image generation service is degraded');
      return false;
    }
  } catch (error) {
    console.error('❌ Image generation service is down:', error);
    return false;
  }
}

// Use in your application startup
checkServiceHealth().then(isHealthy => {
  if (!isHealthy) {
    // Disable image generation features or show warning
    console.warn('Image generation features may be limited');
  }
});
```

## Rate Limiting and Retry Logic

```javascript
class ImageGenerationClient {
  constructor(baseUrl, options = {}) {
    this.baseUrl = baseUrl;
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1000;
    this.timeout = options.timeout || 30000;
  }

  async generateImage(prompt, options = {}) {
    let lastError;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        
        const response = await fetch(`${this.baseUrl}/images/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ prompt, ...options }),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          if (response.status === 429) {
            // Rate limited, wait longer
            const retryAfter = response.headers.get('Retry-After');
            const delay = retryAfter ? parseInt(retryAfter) * 1000 : this.retryDelay * attempt;
            await this.sleep(delay);
            continue;
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return await response.json();
      } catch (error) {
        lastError = error;
        
        if (attempt < this.maxRetries) {
          console.warn(`Attempt ${attempt} failed, retrying in ${this.retryDelay * attempt}ms...`);
          await this.sleep(this.retryDelay * attempt);
        }
      }
    }
    
    throw new Error(`Failed after ${this.maxRetries} attempts: ${lastError.message}`);
  }
  
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Usage
const client = new ImageGenerationClient('https://your-worker.workers.dev', {
  maxRetries: 3,
  retryDelay: 2000,
  timeout: 45000
});

client.generateImage('A peaceful garden scene')
  .then(result => console.log('Generated:', result.url))
  .catch(error => console.error('Failed:', error.message));
```
