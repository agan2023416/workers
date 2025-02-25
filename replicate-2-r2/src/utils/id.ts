/**
 * Generates a unique identifier for image files
 * @returns A string containing a timestamp-based unique identifier
 */
export function generateUniqueId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}