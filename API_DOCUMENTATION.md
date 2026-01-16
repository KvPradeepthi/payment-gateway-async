# Payment Gateway API Documentation

## Base URL
```
https://api.payment-gateway.local
```

## Authentication
All API requests require the following headers:
- `Content-Type: application/json`
- `Idempotency-Key: <UUID>` (for POST requests)

## Error Handling

All error responses follow this format:
```json
{
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

## Endpoints

### 1. Create Payment
**Endpoint:** `POST /payments`

**Description:** Create a new payment with idempotency support

**Request Body:**
```json
{
  "amount": 99.99,
  "currency": "USD",
  "customer_email": "customer@example.com",
  "customer_name": "John Doe",
  "description": "Order #12345",
  "payment_method": "card",
  "metadata": {
    "order_id": "12345",
    "customer_id": "cus_123"
  }
}
```

**Response (201 Created):**
```json
{
  "id": "pay_uuid",
  "status": "pending",
  "amount": 99.99,
  "currency": "USD",
  "created_at": "2026-01-16T12:00:00Z"
}
```

**Status Codes:**
- `201`: Payment created successfully
- `200`: Payment already exists (idempotent)
- `400`: Invalid request parameters
- `500`: Server error

---

### 2. Get Payment Status
**Endpoint:** `GET /payments/{payment_id}`

**Description:** Retrieve payment details and refund history

**Response (200 OK):**
```json
{
  "id": "pay_uuid",
  "idempotency_key": "uuid",
  "amount": 99.99,
  "currency": "USD",
  "status": "completed",
  "customer_email": "customer@example.com",
  "customer_name": "John Doe",
  "description": "Order #12345",
  "payment_method": "card",
  "metadata": {...},
  "created_at": "2026-01-16T12:00:00Z",
  "updated_at": "2026-01-16T12:05:00Z",
  "refunds": [
    {
      "id": "ref_uuid",
      "amount": 20.00,
      "reason": "Partial refund",
      "status": "completed",
      "created_at": "2026-01-16T12:05:00Z"
    }
  ]
}
```

**Possible Payment Statuses:**
- `pending`: Payment is being processed
- `completed`: Payment processed successfully
- `failed`: Payment processing failed
- `refunded`: Payment fully refunded
- `partial_refunded`: Payment partially refunded

**Status Codes:**
- `200`: Payment retrieved successfully
- `404`: Payment not found
- `500`: Server error

---

### 3. Create Refund
**Endpoint:** `POST /payments/{payment_id}/refund`

**Description:** Initiate a full or partial refund for a payment

**Request Body:**
```json
{
  "amount": 20.00,
  "reason": "Customer requested refund"
}
```

**Response (201 Created):**
```json
{
  "id": "ref_uuid",
  "payment_id": "pay_uuid",
  "amount": 20.00,
  "status": "pending",
  "created_at": "2026-01-16T12:05:00Z"
}
```

**Validation Rules:**
- Refund amount cannot exceed payment amount
- Cannot refund an already fully refunded payment
- All refunds are idempotent

**Status Codes:**
- `201`: Refund initiated successfully
- `400`: Invalid refund amount
- `404`: Payment not found
- `500`: Server error

---

### 4. Register Webhook
**Endpoint:** `POST /webhooks`

**Description:** Register a webhook URL for event notifications

**Request Body:**
```json
{
  "url": "https://yourserver.com/webhooks/payment",
  "events": ["payment.completed", "payment.failed", "refund.created"]
}
```

**Response (201 Created):**
```json
{
  "id": "web_uuid",
  "url": "https://yourserver.com/webhooks/payment",
  "events": ["payment.completed", "payment.failed", "refund.created"],
  "active": true,
  "secret": "whsec_xxxxx",
  "created_at": "2026-01-16T12:00:00Z"
}
```

**Status Codes:**
- `201`: Webhook registered successfully
- `400`: Invalid webhook URL or events
- `500`: Server error

---

### 5. List Webhooks
**Endpoint:** `GET /webhooks`

**Description:** Retrieve all registered webhooks

**Response (200 OK):**
```json
[
  {
    "id": "web_uuid",
    "url": "https://yourserver.com/webhooks/payment",
    "events": ["payment.completed"],
    "active": true,
    "created_at": "2026-01-16T12:00:00Z"
  }
]
```

---

### 6. Get Webhook Events
**Endpoint:** `GET /webhooks/{webhook_id}/events?status=pending&limit=50&offset=0`

**Description:** Query webhook event history with retry information

**Query Parameters:**
- `status`: Filter by event status (pending, completed, failed)
- `limit`: Number of events to return (default: 50)
- `offset`: Pagination offset (default: 0)

**Response (200 OK):**
```json
{
  "events": [
    {
      "id": "evt_uuid",
      "event_type": "payment.completed",
      "status": "completed",
      "retry_count": 0,
      "created_at": "2026-01-16T12:00:00Z"
    }
  ],
  "total": 100,
  "limit": 50,
  "offset": 0
}
```

---

### 7. Update Webhook
**Endpoint:** `PATCH /webhooks/{webhook_id}`

**Description:** Update webhook configuration

**Request Body:**
```json
{
  "active": false,
  "url": "https://newserver.com/webhooks/payment",
  "events": ["payment.completed", "refund.created"]
}
```

**Status Codes:**
- `200`: Webhook updated successfully
- `404`: Webhook not found
- `500`: Server error

---

### 8. Delete Webhook
**Endpoint:** `DELETE /webhooks/{webhook_id}`

**Description:** Remove a webhook registration

**Response (200 OK):**
```json
{
  "message": "Webhook deleted successfully"
}
```

---

## Webhook Events

When events occur, webhooks are sent with the following format:

### Webhook Request Headers
```
X-Webhook-Event: payment.completed
X-Webhook-Signature: sha256_hmac_signature
X-Webhook-Timestamp: 1705416000
```

### Webhook Payload Examples

**payment.completed**
```json
{
  "event_type": "payment.completed",
  "payment_id": "pay_uuid",
  "amount": 99.99,
  "email": "customer@example.com",
  "timestamp": "2026-01-16T12:00:00Z"
}
```

**payment.failed**
```json
{
  "event_type": "payment.failed",
  "payment_id": "pay_uuid",
  "amount": 99.99,
  "reason": "Payment declined",
  "timestamp": "2026-01-16T12:00:00Z"
}
```

**refund.created**
```json
{
  "event_type": "refund.created",
  "refund_id": "ref_uuid",
  "payment_id": "pay_uuid",
  "amount": 20.00,
  "timestamp": "2026-01-16T12:00:00Z"
}
```

## Webhook Verification

Verify webhook signatures using HMAC-SHA256:

```javascript
const crypto = require('crypto');

const signature = req.headers['x-webhook-signature'];
const timestamp = req.headers['x-webhook-timestamp'];
const secret = 'your_webhook_secret';

const message = `${timestamp}.${JSON.stringify(req.body)}`;
const expectedSignature = crypto.createHmac('sha256', secret)
  .update(message)
  .digest('hex');

if (signature === expectedSignature) {
  // Webhook is valid
}
```

## Retry Logic

- Initial retry: After 2 seconds
- Subsequent retries: 2^n seconds (exponential backoff)
- Maximum retries: 5 attempts
- Time window: Up to 4 minutes total

## Rate Limiting

- No rate limiting implemented in current version
- Recommended: Implement application-level rate limiting (100 requests/min per IP)

## Best Practices

1. **Always use Idempotency-Key**: Ensures safe retries
2. **Verify Webhook Signatures**: Validate webhook authenticity
3. **Handle Idempotent Responses**: A 200 response means the resource already exists
4. **Implement Exponential Backoff**: For API retries
5. **Log All Transactions**: For audit and debugging
6. **Use HTTPS**: Always communicate over secure channels
