const express = require('express');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');
const { createPaymentQueue } = require('../jobs/paymentQueue');
const { sendWebhookEvent } = require('../services/webhookService');

const router = express.Router();

// Middleware for idempotency
const idempotencyMiddleware = async (req, res, next) => {
  if (!req.headers['idempotency-key']) {
    return next();
  }

  const key = req.headers['idempotency-key'];

  try {
    const result = await pool.query(
      'SELECT response FROM idempotency_keys WHERE key = $1',
      [key]
    );

    if (result.rows.length > 0) {
      return res.status(200).json(result.rows[0].response);
    }
  } catch (error) {
    console.error('Idempotency check error:', error);
  }

  next();
};

// POST /payments - Create a new payment
router.post('/', idempotencyMiddleware, async (req, res) => {
  const client = await pool.connect();
  const idempotencyKey = req.headers['idempotency-key'] || uuidv4();

  try {
    await client.query('BEGIN');

    const {
      amount,
      currency = 'USD',
      customer_email,
      customer_name,
      description,
      payment_method,
      metadata = {}
    } = req.body;

    // Validation
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    if (!customer_email) {
      return res.status(400).json({ error: 'Customer email is required' });
    }

    // Check idempotency key
    const existingPayment = await client.query(
      'SELECT id, status FROM payments WHERE idempotency_key = $1',
      [idempotencyKey]
    );

    if (existingPayment.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(200).json({
        id: existingPayment.rows[0].id,
        status: existingPayment.rows[0].status,
        message: 'Payment already exists'
      });
    }

    // Create payment
    const paymentId = uuidv4();
    const result = await client.query(
      `INSERT INTO payments (
        id, idempotency_key, amount, currency, status,
        customer_email, customer_name, description, payment_method, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, status, created_at`,
      [
        paymentId, idempotencyKey, amount, currency, 'pending',
        customer_email, customer_name, description, payment_method, JSON.stringify(metadata)
      ]
    );

    // Store idempotency response
    const response = {
      id: result.rows[0].id,
      status: result.rows[0].status,
      amount,
      currency,
      created_at: result.rows[0].created_at
    };

    await client.query(
      'INSERT INTO idempotency_keys (key, payment_id, response, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL \'24 hours\')',
      [idempotencyKey, paymentId, JSON.stringify(response)]
    );

    // Queue payment processing job
    await createPaymentQueue().add(
      { paymentId, amount, email: customer_email },
      { jobId: paymentId }
    );

    await client.query('COMMIT');
    res.status(201).json(response);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Payment creation error:', error);
    res.status(500).json({ error: 'Payment processing failed' });
  } finally {
    client.release();
  }
});

// GET /payments/:id - Retrieve payment details
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT * FROM payments WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    const payment = result.rows[0];

    // Get refunds for this payment
    const refundsResult = await pool.query(
      'SELECT id, amount, reason, status, created_at FROM refunds WHERE payment_id = $1 ORDER BY created_at DESC',
      [id]
    );

    res.json({
      ...payment,
      refunds: refundsResult.rows
    });

  } catch (error) {
    console.error('Payment retrieval error:', error);
    res.status(500).json({ error: 'Failed to retrieve payment' });
  }
});

// POST /payments/:id/refund - Initiate a refund
router.post('/:id/refund', idempotencyMiddleware, async (req, res) => {
  const client = await pool.connect();
  const idempotencyKey = req.headers['idempotency-key'] || uuidv4();

  try {
    await client.query('BEGIN');

    const { id: paymentId } = req.params;
    const { amount, reason } = req.body;

    // Get payment
    const paymentResult = await client.query(
      'SELECT id, amount, status FROM payments WHERE id = $1',
      [paymentId]
    );

    if (paymentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Payment not found' });
    }

    const payment = paymentResult.rows[0];

    // Validate refund amount
    const refundAmount = amount || payment.amount;
    if (refundAmount > payment.amount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Refund amount exceeds payment amount' });
    }

    // Create refund
    const refundId = uuidv4();
    const refundResult = await client.query(
      `INSERT INTO refunds (id, payment_id, amount, reason, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, status, created_at`,
      [refundId, paymentId, refundAmount, reason, 'pending']
    );

    await client.query('COMMIT');

    const refund = {
      id: refundResult.rows[0].id,
      payment_id: paymentId,
      amount: refundAmount,
      status: refundResult.rows[0].status,
      created_at: refundResult.rows[0].created_at
    };

    // Send webhook event
    await sendWebhookEvent('refund.created', refund);

    res.status(201).json(refund);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Refund creation error:', error);
    res.status(500).json({ error: 'Refund processing failed' });
  } finally {
    client.release();
  }
});

module.exports = router;
