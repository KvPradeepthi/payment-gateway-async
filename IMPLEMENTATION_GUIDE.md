# Payment Gateway Async - Implementation Guide

This guide provides detailed instructions for completing the implementation of the payment gateway system.

## Project Overview

A production-ready payment gateway that handles:
- Asynchronous payment processing with background jobs
- Webhook delivery with retry mechanisms
- Refund management (full and partial)
- Embeddable JavaScript SDK for modal checkout
- Idempotency key support for preventing duplicate charges

## Architecture

```
┌─────────────────────────────────────────────────┐
│               Merchant Website                   │
│          (Using Embeddable SDK)                 │
└──────────────────┬──────────────────────────────┘
                   │
       ┌───────────┼───────────┐
       │           │           │
       ▼           ▼           ▼
   ┌────────────────────────────────────┐
   │      Express.js API Server         │
   │  (Port 3000)                       │
   │  ├── POST /api/v1/payments         │
   │  ├── POST /api/v1/refunds          │
   │  ├── GET /api/v1/webhooks          │
   │  └── GET /api/v1/test/jobs/status  │
   └────────────┬─────────────┬─────────┘
                │             │
       ┌────────▼──┐  ┌──────▼─────────┐
       │ PostgreSQL │  │   Redis Queue  │
       │  Database  │  │   (Bull/RQ)    │
       └────────────┘  └──────┬─────────┘
                              │
                      ┌───────▼────────┐
                      │  Worker Service│
                      │  (Separate     │
                      │   Process)     │
                      │  ├─ PaymentJob │
                      │  ├─ WebhookJob │
                      │  └─ RefundJob  │
                      └────────────────┘
```

## Implementation Steps

### 1. Database Schema Setup

**Files to Create:**
- `backend/src/migrations/001_initial_schema.sql`

**Key Tables:**

#### merchants
```sql
CREATE TABLE merchants (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  api_key VARCHAR(64) UNIQUE NOT NULL,
  api_secret VARCHAR(64) UNIQUE NOT NULL,
  webhook_url VARCHAR(2048),
  webhook_secret VARCHAR(64),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### payments
```sql
CREATE TABLE payments (
  id VARCHAR(64) PRIMARY KEY,
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  order_id VARCHAR(255) NOT NULL,
  amount BIGINT NOT NULL,
  currency VARCHAR(3) DEFAULT 'INR',
  method VARCHAR(50),
  status VARCHAR(20) DEFAULT 'pending',
  captured BOOLEAN DEFAULT FALSE,
  error_code VARCHAR(100),
  error_description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_payments_merchant ON payments(merchant_id);
CREATE INDEX idx_payments_order ON payments(order_id);
```

#### refunds
```sql
CREATE TABLE refunds (
  id VARCHAR(64) PRIMARY KEY,
  payment_id VARCHAR(64) NOT NULL REFERENCES payments(id),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  amount BIGINT NOT NULL,
  reason TEXT,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP
);

CREATE INDEX idx_refunds_payment ON refunds(payment_id);
```

#### webhook_logs
```sql
CREATE TABLE webhook_logs (
  id UUID PRIMARY KEY,
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  event VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  last_attempt_at TIMESTAMP,
  next_retry_at TIMESTAMP,
  response_code INTEGER,
  response_body TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_webhook_logs_merchant ON webhook_logs(merchant_id);
CREATE INDEX idx_webhook_logs_status ON webhook_logs(status);
CREATE INDEX idx_webhook_logs_retry ON webhook_logs(next_retry_at) WHERE status='pending';
```

#### idempotency_keys
```sql
CREATE TABLE idempotency_keys (
  key VARCHAR(255) NOT NULL,
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  response JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  PRIMARY KEY(key, merchant_id)
);
```

### 2. Backend Application Structure

**Directory Structure:**
```
backend/
├── src/
│   ├── index.js              # Main API server
│   ├── config/
│   │   └── database.js        # Database connection
│   ├── models/
│   │   ├── Payment.js         # Payment model/queries
│   │   ├── Refund.js          # Refund model/queries
│   │   ├── WebhookLog.js      # Webhook log model/queries
│   │   └── Merchant.js        # Merchant model/queries
│   ├── api/
│   │   ├── routes/
│   │   │   ├── payments.js    # Payment endpoints
│   │   │   ├── refunds.js     # Refund endpoints
│   │   │   ├── webhooks.js    # Webhook endpoints
│   │   │   └── health.js      # Health check endpoints
│   │   ├── middleware/
│   │   │   ├── auth.js        # API key/secret validation
│   │   │   └── errorHandler.js
│   │   └── controllers/
│   │       ├── paymentController.js
│   │       ├── refundController.js
│   │       └── webhookController.js
│   ├── workers/
│   │   ├── index.js           # Worker entry point
│   │   ├── PaymentWorker.js   # Payment processing worker
│   │   ├── WebhookWorker.js   # Webhook delivery worker
│   │   └── RefundWorker.js    # Refund processing worker
│   ├── jobs/
│   │   ├── ProcessPaymentJob.js
│   │   ├── DeliverWebhookJob.js
│   │   └── ProcessRefundJob.js
│   ├── utils/
│   │   ├── idGenerator.js     # ID generation (pay_, rfnd_, etc.)
│   │   ├── signatures.js      # HMAC signature verification
│   │   └── retry.js           # Retry logic with exponential backoff
│   └── migrations/
│       └── index.js           # Migration runner
├── Dockerfile                  # Main API container
├── Dockerfile.worker          # Worker service container
└── package.json
```

### 3. Key API Endpoints Implementation

#### POST /api/v1/payments
- Extract API credentials from headers
- Check/handle Idempotency-Key header
- Validate payment data
- Create payment record with status='pending'
- Enqueue ProcessPaymentJob
- Return 201 with payment details

#### POST /api/v1/payments/{payment_id}/refunds
- Validate payment exists and belongs to merchant
- Check payment status is 'success'
- Validate refund amount doesn't exceed payment amount
- Create refund record with status='pending'
- Enqueue ProcessRefundJob
- Return 201 with refund details

#### GET /api/v1/webhooks?limit=10&offset=0
- Query webhook_logs for authenticated merchant
- Return paginated results with status and delivery info

#### POST /api/v1/webhooks/{webhook_id}/retry
- Reset webhook status to 'pending'
- Set attempts to 0
- Enqueue DeliverWebhookJob

#### GET /api/v1/test/jobs/status (Test Endpoint)
- Return job queue statistics
- Return worker status

### 4. Background Job Implementations

#### ProcessPaymentJob
- Fetch payment from database
- Simulate processing delay (5-10 seconds random, or TEST_PROCESSING_DELAY)
- Determine outcome based on success rate
  - UPI: 90% success
  - Card: 95% success
- Update payment status and timestamps
- Enqueue DeliverWebhookJob with 'payment.success' or 'payment.failed'

#### DeliverWebhookJob
- Fetch merchant webhook_url and webhook_secret
- Skip if webhook_url is NULL
- Generate HMAC-SHA256 signature of payload
- Send HTTP POST to webhook_url with:
  - X-Webhook-Signature header
  - Content-Type: application/json
  - 5-second timeout
- Log attempt with response code and body
- On success (200-299): mark webhook as 'success'
- On failure: set next_retry_at based on retry schedule
  - Attempt 1: immediate
  - Attempt 2: 1 minute
  - Attempt 3: 5 minutes
  - Attempt 4: 30 minutes
  - Attempt 5: 2 hours
  - After 5 attempts: mark as 'failed'
- Support TEST mode with shorter intervals for testing

#### ProcessRefundJob
- Fetch refund record
- Verify payment status is 'success'
- Verify total refunded amount doesn't exceed payment amount
- Simulate processing delay (3-5 seconds random)
- Update refund status to 'processed'
- Set processed_at timestamp
- Enqueue DeliverWebhookJob with 'refund.processed' event

### 5. Frontend Components

#### Dashboard (React)
- Payment list with search/filter
- Refund management interface
- Webhook configuration page
- Webhook delivery logs with retry functionality
- Real-time updates of payment status

#### Embeddable SDK
- Create `checkout-widget/src/sdk/PaymentGateway.js`
- Implements modal/iframe based checkout
- postMessage API for cross-origin communication
- Handles payment flow and callbacks
- Support for onSuccess, onFailure, onClose callbacks

### 6. Testing

**Test Endpoints:**
- `GET /api/v1/test/jobs/status` - Check job queue stats
- Create payment with TEST_MODE=true for deterministic results
- Verify webhook delivery with TEST retry intervals

**Environment Variables for Testing:**
- `TEST_MODE=true` - Enable test mode
- `TEST_PAYMENT_SUCCESS=true/false` - Override payment outcome
- `TEST_PROCESSING_DELAY=1000` - Override processing delay (ms)
- `WEBHOOK_RETRY_INTERVALS_TEST=true` - Use test retry intervals

## Deployment Checklist

- [ ] Database migrations applied
- [ ] All environment variables configured
- [ ] Redis connection working
- [ ] PostgreSQL connection working
- [ ] API server health check passing
- [ ] Worker service running
- [ ] Test payment creation works
- [ ] Webhook delivery working
- [ ] Refund processing working
- [ ] Dashboard accessible
- [ ] Embeddable SDK loading

## Resources

- Bull Job Queue: https://github.com/OptimalBits/bull
- Express.js Documentation: https://expressjs.com/
- PostgreSQL Docs: https://www.postgresql.org/docs/
- Redis Documentation: https://redis.io/documentation

## Support

For questions or issues during implementation, refer to the main README.md for API documentation and examples.
