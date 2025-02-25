import { createHmac } from 'crypto';

const webhookSecret = '82ece5343b9c692fe719f7c3e7f7bbb97720a00435f99951fa4dda1aa3eebc68';

const payload = {
  "id": "test_123",
  "status": "succeeded",
  "output": "https://replicate.delivery/pbxt/test/image.png",
  "version": "e0a120ea8afec709aaea8ed4ab5e6b9298b65cd6f43e511cffc3498fc34df33e",
  "created_at": "2024-02-24T11:47:00.000Z"
};

const payloadString = JSON.stringify(payload);
const signature = createHmac('sha256', webhookSecret)
  .update(payloadString)
  .digest('hex');

console.log('Copy this payload to Hoppscotch body:');
console.log(payloadString);
console.log('\nCopy this to replicate-webhook-signature header:');
console.log(signature);