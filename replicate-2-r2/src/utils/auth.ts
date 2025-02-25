/**
 * Verifies the API token from the request against the stored token
 * @param authHeader The Authorization header value from the request
 * @param apiToken The stored API token to verify against
 * @returns boolean indicating whether the token is valid
 */
export function verifySignature(authHeader: string, apiToken: string): boolean {
  if (!authHeader.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.split(' ')[1];
  return token === apiToken;
}