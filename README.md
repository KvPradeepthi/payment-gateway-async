# payment-gateway-async
Production-ready payment gateway with async processing, webhooks, refund management, and embeddable SDK. Demonstrates advanced architectural patterns for handling payments at scale.


## Features

- **Asynchronous Payment Processing**: Background job queue using Redis for non-blocking payment processing
- **Webhook System**: Deliver payment events to merchant endpoints with automatic retry logic and HMAC signature verification
- **Refund Management**: Support for full and partial refunds processed asynchronously
- **Embeddable SDK**: Cross-origin JavaScript SDK for modal/iframe-based checkout
- **Idempotency Keys**: Prevent duplicate charges on network retries
- **Production-Ready Dashboard**: Monitor payments, webhooks, and refunds

## Tech Stack

### Backend
- **Framework**: Express.js (Node.js)
- **Database**: PostgreSQL
- **Job Queue**: Redis + Bull
- **Language**: JavaScript/TypeScript

### Frontend
- **Dashboard**: React
- **Checkout Widget**: Vanilla JavaScript + HTML/CSS
- **Build Tool**: Webpack

### DevOps
- **Containerization**: Docker & Docker Compose
- **Services**: API, Worker, Dashboard, Checkout

## Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 18+ (for development)
- PostgreSQL (or use Docker image)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/KvPradeepthi/payment-gateway-async.git
cd payment-gateway-async
```

2. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. Start services with Docker Compose:
```bash
docker-compose up -d
```

4. Initialize database:
```bash
docker exec gateway_api npm run migrate
```

5. Verify services are running:
```bash
curl http://localhost:3000/api/v1/health
```

## Environment Variables

```bash
# API Configuration
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://gateway_user:gateway_pass@postgres:5432/payment_gateway

# Redis
REDIS_URL=redis://redis:6379

# Payment Gateway
TEST_MODE=false
TEST_PAYMENT_SUCCESS=true
TEST_PROCESSING_DELAY=1000
WEBHOOK_RETRY_INTERVALS_TEST=false

# Dashboard
DASHBOARD_PORT=3001
```

## API Documentation

### Base URL
```
http://localhost:3000/api/v1
```

### Authentication
All endpoints require API credentials in headers:
```
X-Api-Key: key_test_abc123
X-Api-Secret: secret_test_xyz789
```

### Endpoints

#### Create Payment
```http
POST /api/v1/payments
Content-Type: application/json
X-Api-Key: key_test_abc123
X-Api-Secret: secret_test_xyz789
Idempotency-Key: unique_request_id_123 (optional)

{
  "order_id": "order_NXhj67fGH2jk9mPq",
  "method": "upi",
  "vpa": "user@paytm"
}
```

**Response (201)**:
```json
{
  "id": "pay_H8sK3jD9s2L1pQr",
  "order_id": "order_NXhj67fGH2jk9mPq",
  "amount": 50000,
  "currency": "INR",
  "method": "upi",
  "vpa": "user@paytm",
  "status": "pending",
  "created_at": "2024-01-15T10:31:00Z"
}
```

#### Get Payment
```http
GET /api/v1/payments/{payment_id}
X-Api-Key: key_test_abc123
X-Api-Secret: secret_test_xyz789
```

#### Create Refund
```http
POST /api/v1/payments/{payment_id}/refunds
Content-Type: application/json
X-Api-Key: key_test_abc123
X-Api-Secret: secret_test_xyz789

{
  "amount": 50000,
  "reason": "Customer requested refund"
}
```

**Response (201)**:
```json
{
  "id": "rfnd_K9pL2mN4oQ5r",
  "payment_id": "pay_H8sK3jD9s2L1pQr",
  "amount": 50000,
  "reason": "Customer requested refund",
  "status": "pending",
  "created_at": "2024-01-15T10:33:00Z"
}
```

#### Get Refund
```http
GET /api/v1/refunds/{refund_id}
X-Api-Key: key_test_abc123
X-Api-Secret: secret_test_xyz789
```

#### List Webhook Logs
```http
GET /api/v1/webhooks?limit=10&offset=0
X-Api-Key: key_test_abc123
X-Api-Secret: secret_test_xyz789
```

#### Retry Webhook
```http
POST /api/v1/webhooks/{webhook_id}/retry
X-Api-Key: key_test_abc123
X-Api-Secret: secret_test_xyz789
```

#### Job Queue Status (Test Endpoint)
```http
GET /api/v1/test/jobs/status
```

**Response (200)**:
```json
{
  "pending": 5,
  "processing": 2,
  "completed": 100,
  "failed": 0,
  "worker_status": "running"
}
```

## Webhook Events

Webhook events include:
- `payment.created` - When payment record is created
- `payment.pending` - When payment enters pending state
- `payment.success` - When payment succeeds
- `payment.failed` - When payment fails
- `refund.created` - When refund is initiated
- `refund.processed` - When refund completes

### Webhook Payload Format
```json
{
  "event": "payment.success",
  "timestamp": 1705315870,
  "data": {
    "payment": {
      "id": "pay_H8sK3jD9s2L1pQr",
      "order_id": "order_NXhj67fGH2jk9mPq",
      "amount": 50000,
      "currency": "INR",
      "method": "upi",
      "vpa": "user@paytm",
      "status": "success",
      "created_at": "2024-01-15T10:31:00Z"
    }
  }
}
```

### HMAC Signature Verification

All webhooks include an `X-Webhook-Signature` header containing an HMAC-SHA256 signature. Verify using:

```javascript
const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
  const hash = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  return hash === signature;
}
```

## Embeddable SDK

### Installation

Add script to your website:
```html
<script src="https://cdn.yourgateway.com/checkout.js"></script>

<button id="pay-button">Pay Now</button>

<script>
document.getElementById('pay-button').addEventListener('click', function() {
  const checkout = new PaymentGateway({
    key: 'key_test_abc123',
    orderId: 'order_xyz',
    onSuccess: function(response) {
      console.log('Payment successful:', response.paymentId);
    },
    onFailure: function(error) {
      console.log('Payment failed:', error);
    },
    onClose: function() {
      console.log('Modal closed');
    }
  });
  
  checkout.open();
});
</script>
```

## Testing

### Run Tests
```bash
docker exec gateway_api npm test
```

### Health Checks
```bash
# API Health
curl http://localhost:3000/api/v1/health

# Database Connection
curl http://localhost:3000/api/v1/health/db

# Redis Connection
curl http://localhost:3000/api/v1/health/redis
```

### Test Payment Creation
```bash
curl -X POST http://localhost:3000/api/v1/payments \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: key_test_abc123" \
  -H "X-Api-Secret: secret_test_xyz789" \
  -d '{
    "order_id": "order_test_123",
    "method": "upi",
    "vpa": "user@paytm"
  }'
```

## Database Schema

### Tables
- `merchants` - Merchant accounts and credentials
- `payments` - Payment records
- `refunds` - Refund records
- `webhook_logs` - Webhook delivery logs
- `idempotency_keys` - Idempotency key cache

### Indexes
- `refunds.payment_id` - For efficient payment refund queries
- `webhook_logs.merchant_id` - For merchant webhook queries
- `webhook_logs.status` - For status-based queries
- `webhook_logs.next_retry_at` - For retry scheduling

## Architecture

### Components
1. **API Server**: Express.js REST API
2. **Worker Service**: Background job processor
3. **Database**: PostgreSQL for persistent storage
4. **Message Queue**: Redis for job queuing
5. **Dashboard**: React-based admin interface
6. **Checkout Widget**: Embeddable JavaScript component

### Async Processing Flow
1. Client creates payment via API
2. Payment stored in database with 'pending' status
3. ProcessPaymentJob enqueued to job queue
4. Worker picks up job and processes payment
5. Payment status updated to 'success' or 'failed'
6. DeliverWebhookJob enqueued for event delivery
7. Worker delivers webhook with retries on failure

## Development

### Project Structure
```
payment-gateway-async/
├── backend/
│   ├── src/
│   │   ├── api/
│   │   │   ├── controllers/
│   │   │   ├── routes/
│   │   │   └── middleware/
│   │   ├── workers/
│   │   │   ├── PaymentWorker.js
│   │   │   ├── WebhookWorker.js
│   │   │   └── RefundWorker.js
│   │   ├── jobs/
│   │   │   ├── ProcessPaymentJob.js
│   │   │   ├── DeliverWebhookJob.js
│   │   │   └── ProcessRefundJob.js
│   │   ├── models/
│   │   ├── services/
│   │   └── utils/
│   ├── migrations/
│   ├── Dockerfile
│   ├── Dockerfile.worker
│   └── package.json
├── dashboard/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   └── App.jsx
│   └── package.json
├── checkout-widget/
│   ├── src/
│   │   ├── sdk/
│   │   │   ├── PaymentGateway.js
│   │   │   ├── modal.js
│   │   │   └── styles.css
│   │   └── iframe-content/
│   │       └── CheckoutForm.jsx
│   ├── webpack.config.js
│   └── package.json
├── docker-compose.yml
└── README.md
```

## Deployment

### Docker Compose
```bash
docker-compose up -d
```

### Environment Setup
1. Configure `.env` file with production values
2. Use strong API keys and secrets
3. Enable webhook signature verification
4. Configure webhooks for production endpoints
5. Set up monitoring and logging

## Support & Troubleshooting

### Common Issues

**Services won't start**
- Check Docker is running
- Verify ports are not in use
- Check logs: `docker-compose logs -f`

**Database migration failed**
- Ensure PostgreSQL is healthy
- Check database credentials in `.env`
- Run migrations manually if needed

**Webhooks not delivering**
- Verify merchant webhook_url is configured
- Check webhook logs in dashboard
- Verify webhook_secret is correct

## License

MIT License - See LICENSE file for details

## Contributing

Contributions are welcome! Please follow the project's code style and submit pull requests.

## Contact

For questions or support, contact the development team.
