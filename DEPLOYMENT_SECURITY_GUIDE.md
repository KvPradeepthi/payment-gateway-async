# Deployment and Security Guide

## Production Deployment

### 1. Prerequisites

- Docker and Docker Compose installed
- PostgreSQL 12+ running
- Redis 6+ running
- Node.js 16+ LTS
- HTTPS certificate for domain
- Environment variables configured

### 2. Environment Setup

Create `.env` file with production values:

```bash
# Database
DB_HOST=postgresql.prod.internal
DB_PORT=5432
DB_NAME=payment_gateway_prod
DB_USER=pg_user
DB_PASSWORD=<strong-password>

# Redis
REDIS_HOST=redis.prod.internal
REDIS_PORT=6379
REDIS_PASSWORD=<redis-password>

# API Server
NODE_ENV=production
PORT=3000
API_URL=https://api.payment-gateway.com

# Logging
LOG_LEVEL=info
LOG_FILE=/var/log/payment-gateway/app.log

# Webhook
WEBHOOK_RETRY_MAX=5
WEBHOOK_TIMEOUT=5000
WEBHOOK_SIGNATURE_VERSION=sha256

# Security
CORS_ORIGINS=https://yourdomain.com
RATIONALE_LIMIT=100
RATIONALE_WINDOW=60000
```

### 3. Docker Deployment

#### Build Images

```bash
docker build -f backend/Dockerfile -t payment-gateway:latest .
docker build -f backend/Dockerfile.worker -t payment-gateway-worker:latest .
```

#### Run with Docker Compose

```bash
docker-compose -f docker-compose.yml up -d
```

#### Verify Services

```bash
# Check container status
docker-compose ps

# View logs
docker-compose logs -f api
docker-compose logs -f worker
docker-compose logs -f postgres
```

### 4. Database Migration

```bash
# Run migrations
docker-compose exec api npm run migrate

# Or manually:
psql postgresql://user:pass@host:5432/payment_gateway < backend/src/migrations/001_initial_schema.sql
```

### 5. Health Checks

Test API endpoint:

```bash
curl -X GET http://localhost:3000/health

# Expected response:
{
  "status": "ok",
  "timestamp": "2026-01-16T12:00:00Z",
  "database": "connected",
  "redis": "connected"
}
```

---

## Security Best Practices

### 1. API Security

#### HTTPS/TLS Only
```nginx
server {
    listen 80;
    server_name api.payment-gateway.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.payment-gateway.com;
    
    ssl_certificate /etc/letsencrypt/live/api.payment-gateway.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.payment-gateway.com/privkey.pem;
    
    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
}
```

#### Rate Limiting
```javascript
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,                   // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);
```

#### CORS Configuration
```javascript
const cors = require('cors');

app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(','),
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Idempotency-Key']
}));
```

### 2. Data Security

#### Input Validation
```javascript
const { body, validationResult } = require('express-validator');

router.post('/payments', [
  body('amount').isFloat({ min: 0.01 }).toFloat(),
  body('currency').isLength({ min: 3, max: 3 }).isUppercase(),
  body('customer_email').isEmail(),
  body('customer_name').trim().isLength({ min: 1 })
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  // Process payment
});
```

#### Password Hashing
```javascript
const bcrypt = require('bcrypt');

// Hash webhook secret
const hashedSecret = await bcrypt.hash(webhookSecret, 10);

// Verify
const isValid = await bcrypt.compare(providedSecret, hashedSecret);
```

#### Encryption
```javascript
const crypto = require('crypto');

const encryptSecret = (secret, key) => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key), iv);
  const encrypted = cipher.update(secret);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${encrypted.toString('hex')}:${authTag.toString('hex')}`;
};
```

### 3. Database Security

#### Connection Security
```javascript
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: true }
});
```

#### Backup Strategy
```bash
#!/bin/bash
# Daily backup script

BACKUP_DIR="/backups/postgresql"
DB_NAME="payment_gateway"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

pg_dump -h ${DB_HOST} -U ${DB_USER} ${DB_NAME} | \
  gzip > ${BACKUP_DIR}/backup_${TIMESTAMP}.sql.gz

# Cleanup old backups (keep last 30 days)
find ${BACKUP_DIR} -name "backup_*.sql.gz" -mtime +30 -delete
```

### 4. Webhook Security

#### Signature Verification
```javascript
const crypto = require('crypto');

const verifyWebhookSignature = (payload, signature, secret, timestamp) => {
  // Check timestamp (5 minute tolerance)
  const now = Date.now();
  if (Math.abs(now - parseInt(timestamp)) > 5 * 60 * 1000) {
    return false;
  }
  
  // Verify HMAC
  const message = `${timestamp}.${JSON.stringify(payload)}`;
  const expected = crypto.createHmac('sha256', secret)
    .update(message)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
};
```

#### Webhook Retry Security
```javascript
// Exponential backoff with jitter
const calculateBackoff = (retryCount) => {
  const baseDelay = Math.pow(2, retryCount) * 1000;
  const jitter = Math.random() * baseDelay * 0.1;
  return baseDelay + jitter;
};
```

### 5. Monitoring and Logging

#### Structured Logging
```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  defaultMeta: { service: 'payment-gateway' },
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// Log important events
logger.info('Payment created', {
  paymentId: payment.id,
  amount: payment.amount,
  customerId: payment.customer_id
});
```

#### Error Monitoring
```javascript
const Sentry = require('@sentry/node');

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1.0
});

app.use(Sentry.Handlers.errorHandler());
```

### 6. Access Control

#### API Key Authentication
```javascript
const authenticateAPI = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }
  
  // Verify against database or cache
  const isValid = validateAPIKey(apiKey);
  if (!isValid) {
    return res.status(403).json({ error: 'Invalid API key' });
  }
  
  next();
};
```

#### Role-Based Access Control
```javascript
const authorize = (roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};

router.patch('/payments/:id/refund', authorize(['admin', 'finance']), refundPayment);
```

---

## Incident Response

### 1. Security Breach Protocol

1. **Isolate**: Immediately disconnect affected systems
2. **Assess**: Determine scope and impact
3. **Contain**: Stop spread of vulnerability
4. **Notify**: Alert stakeholders and customers
5. **Investigate**: Root cause analysis
6. **Remediate**: Fix and patch vulnerabilities
7. **Monitor**: Increased surveillance post-incident

### 2. DDoS Mitigation

- Use CDN with DDoS protection (CloudFlare, AWS Shield)
- Implement rate limiting
- Monitor traffic patterns
- Auto-scaling for traffic spikes

### 3. Data Breach Response

```bash
#!/bin/bash
# Immediate actions on suspected breach

# 1. Revoke compromised API keys
psql -c "DELETE FROM api_keys WHERE created_at < NOW() - INTERVAL '1 hour';"

# 2. Audit recent changes
psql -c "SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 100;"

# 3. Block suspicious IPs
sudo ufw insert 1 deny from <ip-address>

# 4. Generate incident report
echo "Incident Report: $(date)" >> incident.log
```

---

## Compliance

### PCI DSS Compliance
- [ ] Use HTTPS/TLS for all data transmission
- [ ] Never log full credit card numbers
- [ ] Implement strong authentication
- [ ] Maintain audit logs
- [ ] Regular security testing
- [ ] Vulnerability management program
- [ ] Network segmentation

### GDPR Compliance
- [ ] Right to be forgotten
- [ ] Data portability
- [ ] Consent management
- [ ] Privacy by design
- [ ] Data processing agreements
- [ ] Breach notification (72 hours)

### Implementation
```sql
-- Anonymize customer data (GDPR right to be forgotten)
CREATE FUNCTION anonymize_customer(customer_id UUID) RETURNS void AS $$
BEGIN
  UPDATE payments 
  SET customer_email = 'redacted@example.com',
      customer_name = 'Redacted'
  WHERE payment_id IN (
    SELECT id FROM payments WHERE customer_id = $1
  );
END;
$$ LANGUAGE plpgsql;
```

---

## Troubleshooting

### Common Issues

**Issue**: Database connection timeout
```bash
# Check PostgreSQL status
sudo systemctl status postgresql

# Verify credentials
psql -h localhost -U postgres -c "SELECT 1;"

# Check connection pool
SELECT datname, count(*) FROM pg_stat_activity GROUP BY datname;
```

**Issue**: Webhook delivery failures
```javascript
// Check webhook event history
SELECT * FROM webhook_events 
WHERE status = 'failed' 
ORDER BY created_at DESC LIMIT 10;

// Manual retry
UPDATE webhook_events 
SET status = 'pending', retry_count = 0
WHERE id = 'evt_id';
```

**Issue**: High memory usage
```bash
# Check Redis memory
redis-cli INFO memory

# Clear cache
redis-cli FLUSHDB

# Monitor queue
redis-cli LLEN bull:payments:active
```
