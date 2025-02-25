const MAX_TIMESTAMP_DIFF = 300; // 5 minutes in seconds

export async function verifyWebhookSignature(
  webhookId: string,
  webhookTimestamp: string,
  webhookSignature: string,
  body: string,
  webhookSecret: string
): Promise<boolean> {
  try {
    // Verify timestamp to prevent replay attacks
    const timestampNum = parseInt(webhookTimestamp, 10);
    const currentTimestamp = Math.floor(Date.now() / 1000);
    if (Math.abs(currentTimestamp - timestampNum) > MAX_TIMESTAMP_DIFF) {
      console.error('Webhook timestamp is too old');
      return false;
    }

    // Construct the signed content
    const signedContent = `${webhookId}.${webhookTimestamp}.${body}`;

    // Get the secret key (remove 'whsec_' prefix)
    const secretKey = webhookSecret.startsWith('whsec_') 
      ? webhookSecret.slice(6) 
      : webhookSecret;

    // Convert the base64 secret to a Uint8Array
    const secretBytes = Uint8Array.from(atob(secretKey), c => c.charCodeAt(0));

    // Convert the signed content to Uint8Array
    const encoder = new TextEncoder();
    const signedContentBytes = encoder.encode(signedContent);

    // Import the secret key
    const key = await crypto.subtle.importKey(
      'raw',
      secretBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    // Calculate the signature
    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      signedContentBytes
    );

    // Convert the signature to base64
    const computedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)));

    // Split webhook signatures and verify against all of them
    const expectedSignatures = webhookSignature
      .split(' ')
      .map(sig => sig.split(',')[1]);

    // Compare signatures
    return expectedSignatures.some(expectedSig => {
      try {
        const expectedBytes = Uint8Array.from(atob(expectedSig), c => c.charCodeAt(0));
        const computedBytes = Uint8Array.from(atob(computedSignature), c => c.charCodeAt(0));
        
        if (expectedBytes.length !== computedBytes.length) {
          return false;
        }

        // Constant-time comparison
        let result = 0;
        for (let i = 0; i < expectedBytes.length; i++) {
          result |= expectedBytes[i] ^ computedBytes[i];
        }
        return result === 0;
      } catch {
        return false;
      }
    });
  } catch (error) {
    console.error('Error verifying webhook signature:', error);
    return false;
  }
}