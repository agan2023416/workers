/**
 * Create standardized success response
 */
export function createSuccessResponse<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Cache-Control': 'no-cache',
    },
  });
}

/**
 * Create standardized error response
 */
export function createErrorResponse(message: string, status = 400): Response {
  return new Response(
    JSON.stringify({
      error: message,
      timestamp: new Date().toISOString(),
    }),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Cache-Control': 'no-cache',
      },
    }
  );
}

/**
 * Create response with custom headers
 */
export function createCustomResponse(
  data: any,
  status = 200,
  additionalHeaders: Record<string, string> = {}
): Response {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    ...additionalHeaders,
  };

  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}
