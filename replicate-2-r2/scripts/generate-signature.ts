import { createHmac } from 'crypto';

const webhookSecret = '82ece5343b9c692fe719f7c3e7f7bbb97720a00435f99951fa4dda1aa3eebc68';

const payload = {
  "id": "test_123",
  "status": "succeeded" as const,
  "output": "https://replicate.delivery/pbxt/test/image.png",
  "version": "e0a120ea8afec709aaea8ed4ab5e6b9298b65cd6f43e511cffc3498fc34df33e",
  "created_at": new Date().toISOString()
};

const payloadString = JSON.stringify(payload, null, 2);
const signature = createHmac('sha256', webhookSecret)
  .update(payloadString)
  .digest('hex');

console.log('\x1b[36m%s\x1b[0m', 'For Hoppscotch Setup:');
console.log('\n1. URL: https://replicate-worker.agan2023416.workers.dev/webhooks/replicate');
console.log('2. Method: POST');
console.log('3. Headers:');
console.log('   Content-Type: application/json');
console.log('   replicate-webhook-signature:', signature);
console.log('\n4. Body (copy exactly):');
console.log(payloadString);

// Alternative development mode instructions
console.log('\n\x1b[33m%s\x1b[0m', 'Or for development testing without signature:');
console.log('Headers:');
console.log('   Content-Type: application/json');
console.log('   x-development-mode: true');
console.log('\nBody can be simpler:');
console.log(JSON.stringify({
  id: "test_123",
  status: "succeeded",
  output: "https://replicate.delivery/pbxt/test/image.png"
}, null, 2));