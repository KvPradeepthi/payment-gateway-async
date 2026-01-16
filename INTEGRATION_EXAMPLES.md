# Integration Examples

This document provides practical examples of how to integrate with the Payment Gateway API.

## Table of Contents
1. [Node.js/Express Backend](#nodejs-express-backend)
2. [Browser JavaScript SDK](#browser-javascript-sdk)
3. [Webhook Handler](#webhook-handler)
4. [Error Handling](#error-handling)
5. [Testing](#testing)

---

## Node.js/Express Backend

### 1. Create a Payment

```javascript
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const createPayment = async (req, res) => {
  try {
    const idempotencyKey = uuidv4();
    const paymentData = {
      amount: 99.99,
      currency: 'USD',
      customer_email: req.body.email,
      customer_name: req.body.name,
      description: `Order #${req.body.orderId}`,
      payment_method: 'card',
      metadata: {
        order_id: req.body.orderId,
        user_id: req.user.id
      }
    };

    const response = await axios.post(
      'https://api.payment-gateway.local/payments',
      paymentData,
      {
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        }
      }
    );

    res.json({ success: true, payment: response.data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = { createPayment };
```

### 2. Get Payment Status

```javascript
const getPaymentStatus = async (req, res) => {
  try {
    const { paymentId } = req.params;
    
    const response = await axios.get(
      `https://api.payment-gateway.local/payments/${paymentId}`
    );

    res.json({ success: true, payment: response.data });
  } catch (error) {
    if (error.response?.status === 404) {
      res.status(404).json({ error: 'Payment not found' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
};

module.exports = { getPaymentStatus };
```

### 3. Initiate Refund

```javascript
const initiateRefund = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { amount, reason } = req.body;
    const idempotencyKey = uuidv4();

    const refundData = { amount, reason };

    const response = await axios.post(
      `https://api.payment-gateway.local/payments/${paymentId}/refund`,
      refundData,
      {
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        }
      }
    );

    res.json({ success: true, refund: response.data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = { initiateRefund };
```

---

## Browser JavaScript SDK

### 1. Initialize SDK

```html
<script src="/sdk/payment-gateway-sdk.js"></script>

<script>
const gateway = new PaymentGateway({
  apiUrl: 'https://api.payment-gateway.local',
  merchantId: 'your_merchant_id',
  publicKey: 'your_public_key',
  timeout: 30000,
  onSuccess: function(payment) {
    console.log('Payment created:', payment);
    // Update UI, redirect user, etc.
  },
  onError: function(error) {
    console.error('Payment error:', error);
    // Show error message to user
  }
});
</script>
```

### 2. Create Payment from Frontend

```javascript
document.getElementById('paymentForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const paymentData = {
    amount: parseFloat(document.getElementById('amount').value),
    currency: 'USD',
    customer_email: document.getElementById('email').value,
    customer_name: document.getElementById('name').value,
    description: document.getElementById('description').value,
    payment_method: 'card'
  };

  try {
    const payment = await gateway.createPayment(paymentData);
    console.log('Payment successful:', payment.id);
    // Redirect to success page
    window.location.href = `/success?paymentId=${payment.id}`;
  } catch (error) {
    console.error('Payment failed:', error.message);
    alert('Payment failed: ' + error.message);
  }
});
```

### 3. Check Payment Status

```javascript
async function checkPaymentStatus(paymentId) {
  try {
    const payment = await gateway.getPayment(paymentId);
    
    if (payment.status === 'completed') {
      document.getElementById('status').textContent = 'Payment Completed';
    } else if (payment.status === 'failed') {
      document.getElementById('status').textContent = 'Payment Failed';
    } else {
      document.getElementById('status').textContent = 'Payment Pending';
    }
    
    return payment;
  } catch (error) {
    console.error('Status check failed:', error);
  }
}
```

### 4. Process Refund from Frontend

```javascript
async function refundPayment(paymentId) {
  const amount = parseFloat(prompt('Enter refund amount:'));
  if (!amount) return;
  
  try {
    const refund = await gateway.refundPayment(paymentId, {
      amount: amount,
      reason: 'Customer request'
    });
    
    alert('Refund initiated: ' + refund.id);
  } catch (error) {
    alert('Refund failed: ' + error.message);
  }
}
```

---

## Webhook Handler

### 1. Webhook Endpoint (Express)

```javascript
const express = require('express');
const crypto = require('crypto');
const app = express();

app.post('/webhooks/payment', express.json(), (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];
  const secret = process.env.WEBHOOK_SECRET;

  // Verify signature
  const message = `${timestamp}.${JSON.stringify(req.body)}`;
  const expectedSignature = crypto.createHmac('sha256', secret)
    .update(message)
    .digest('hex');

  if (signature !== expectedSignature) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Process webhook
  const event = req.body;
  
  switch (event.event_type) {
    case 'payment.completed':
      handlePaymentCompleted(event);
      break;
    case 'payment.failed':
      handlePaymentFailed(event);
      break;
    case 'refund.created':
      handleRefundCreated(event);
      break;
    default:
      console.log('Unknown event:', event.event_type);
  }

  // Acknowledge receipt
  res.json({ received: true });
});

function handlePaymentCompleted(event) {
  console.log('Payment completed:', event.payment_id);
  // Update database, send confirmation email, etc.
}

function handlePaymentFailed(event) {
  console.log('Payment failed:', event.payment_id, event.reason);
  // Send failure notification, log error, etc.
}

function handleRefundCreated(event) {
  console.log('Refund created:', event.refund_id, event.amount);
  // Update order status, notify customer, etc.
}

app.listen(3000);
```

### 2. Webhook Registration

```javascript
const registerWebhook = async () => {
  const webhookData = {
    url: 'https://yourserver.com/webhooks/payment',
    events: ['payment.completed', 'payment.failed', 'refund.created']
  };

  const response = await axios.post(
    'https://api.payment-gateway.local/webhooks',
    webhookData
  );

  console.log('Webhook registered:', response.data.id);
  // Save webhook secret securely
  process.env.WEBHOOK_SECRET = response.data.secret;
};
```

---

## Error Handling

### 1. Retry Logic with Exponential Backoff

```javascript
const retryWithBackoff = async (fn, maxRetries = 3) => {
  let lastError;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 1000; // 1s, 2s, 4s
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
};

// Usage
const payment = await retryWithBackoff(() => 
  gateway.createPayment(paymentData)
);
```

### 2. Error Response Handling

```javascript
const handlePaymentError = (error) => {
  if (error.response) {
    const status = error.response.status;
    const errorMsg = error.response.data.error;
    
    switch (status) {
      case 400:
        console.error('Invalid request:', errorMsg);
        return 'Please check your payment information';
      case 404:
        console.error('Payment not found:', errorMsg);
        return 'Payment not found';
      case 500:
        console.error('Server error:', errorMsg);
        return 'Server error. Please try again later';
      default:
        return 'An unexpected error occurred';
    }
  } else if (error.request) {
    console.error('No response from server');
    return 'Network error. Please check your connection';
  } else {
    console.error('Error:', error.message);
    return error.message;
  }
};
```

---

## Testing

### 1. Unit Test Example (Jest)

```javascript
describe('Payment Gateway', () => {
  let gateway;

  beforeEach(() => {
    gateway = new PaymentGateway({
      apiUrl: 'https://api.payment-gateway.local'
    });
  });

  test('should create payment successfully', async () => {
    const paymentData = {
      amount: 99.99,
      currency: 'USD',
      customer_email: 'test@example.com',
      customer_name: 'Test User'
    };

    const payment = await gateway.createPayment(paymentData);
    
    expect(payment).toHaveProperty('id');
    expect(payment.status).toBe('pending');
    expect(payment.amount).toBe(99.99);
  });

  test('should retrieve payment status', async () => {
    const payment = await gateway.getPayment('pay_test_id');
    
    expect(payment).toHaveProperty('id');
    expect(['pending', 'completed', 'failed']).toContain(payment.status);
  });

  test('should handle refund request', async () => {
    const refund = await gateway.refundPayment('pay_test_id', {
      amount: 50.00,
      reason: 'Test refund'
    });
    
    expect(refund).toHaveProperty('id');
    expect(refund.status).toBe('pending');
  });
});
```

### 2. Integration Test

```javascript
test('complete payment flow', async () => {
  // 1. Create payment
  const payment = await gateway.createPayment({
    amount: 99.99,
    currency: 'USD',
    customer_email: 'test@example.com',
    customer_name: 'Test User'
  });

  expect(payment.status).toBe('pending');
  const paymentId = payment.id;

  // 2. Wait for processing
  await new Promise(resolve => setTimeout(resolve, 3000));

  // 3. Check payment status
  const updatedPayment = await gateway.getPayment(paymentId);
  expect(['completed', 'failed']).toContain(updatedPayment.status);

  // 4. Initiate refund if completed
  if (updatedPayment.status === 'completed') {
    const refund = await gateway.refundPayment(paymentId, {
      amount: 20.00,
      reason: 'Test refund'
    });
    expect(refund.status).toBe('pending');
  }
});
```

---

## Production Checklist

- [ ] Use HTTPS only
- [ ] Store webhook secret securely
- [ ] Implement rate limiting
- [ ] Log all transactions
- [ ] Set up monitoring and alerts
- [ ] Test webhook handling
- [ ] Implement idempotency key management
- [ ] Verify webhook signatures
- [ ] Handle all error cases
- [ ] Test refund flows
- [ ] Monitor payment processing latency
- [ ] Set up automatic retry logic
