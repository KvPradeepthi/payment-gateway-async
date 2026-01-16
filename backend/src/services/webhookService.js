const crypto = require('crypto');
const axios = require('axios');

// Send webhook event to a URL
const sendWebhookEvent = async (eventType, payload, webhook) => {
  try {
    const webhookUrl = webhook.url || webhook;
    const secret = webhook.secret || '';
    const timestamp = Date.now().toString();

    // Create signature for webhook verification
    const signature = generateSignature(payload, secret, timestamp);

    const response = await axios.post(webhookUrl, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Event': eventType,
        'X-Webhook-Signature': signature,
        'X-Webhook-Timestamp': timestamp
      },
      timeout: 5000
    });

    return { success: true, statusCode: response.status };
  } catch (error) {
    console.error(`Webhook delivery failed for ${webhookUrl}:`, error.message);
    throw new Error(`Webhook delivery failed: ${error.message}`);
  }
};

// Generate HMAC signature for webhook verification
const generateSignature = (payload, secret, timestamp) => {
  const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const message = `${timestamp}.${payloadString}`;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(message);
  return hmac.digest('hex');
};

// Verify webhook signature
const verifyWebhookSignature = (payload, signature, secret, timestamp, tolerance = 300000) => {
  // Check timestamp (default tolerance: 5 minutes)
  const currentTime = Date.now();
  if (Math.abs(currentTime - parseInt(timestamp)) > tolerance) {
    return false;
  }

  // Verify signature
  const expectedSignature = generateSignature(payload, secret, timestamp);
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
};

// Send webhook with retry information
const sendWebhookWithRetry = async (webhook, event, maxRetries = 5) => {
  let retryCount = 0;
  let lastError = null;

  while (retryCount < maxRetries) {
    try {
      const result = await sendWebhookEvent(event.event_type, event.payload, webhook);
      return { success: true, result, retryCount };
    } catch (error) {
      lastError = error;
      retryCount++;

      if (retryCount < maxRetries) {
        // Exponential backoff: 2^n seconds
        const backoffSeconds = Math.pow(2, retryCount);
        console.log(`Webhook retry ${retryCount}/${maxRetries} scheduled in ${backoffSeconds}s`);
        await new Promise(resolve => setTimeout(resolve, backoffSeconds * 1000));
      }
    }
  }

  return { success: false, error: lastError.message, retryCount };
};

module.exports = {
  sendWebhookEvent,
  generateSignature,
  verifyWebhookSignature,
  sendWebhookWithRetry
};
