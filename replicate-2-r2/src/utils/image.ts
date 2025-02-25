/**
 * Downloads an image from a given URL
 * @param url The URL of the image to download
 * @returns A Promise that resolves to an ArrayBuffer containing the image data
 */
export async function downloadImage(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.statusText}`);
  }
  return response.arrayBuffer();
}