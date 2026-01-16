const Queue = require('bull');
const pool = require('../db');
const { sendWebhookEvent } = require('../services/webhookService');

let paymentQueue = null;

const createPaymentQueue = () => {
  if (!paymentQueue) {
    paymentQueue = new Queue('payments', {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379
      }
    });

    // Process payment jobs
    paymentQueue.process(async (job) => {
      return processPayment(job.data);
    });

    // Job completion handler
    paymentQueue.on('completed', (job) => {
      console.log(`Payment job ${job.id} completed successfully`);
    });

    // Job failure handler
    paymentQueue.on('failed', (job, err) => {
      console.error(`Payment job ${job.id} failed:`, err);
    });
  }
  return paymentQueue;
};

// Process payment function
const processPayment = async (data) => {
  const { paymentId, amount, email } = data;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Simulate payment processing
    const processingDelay = new Promise(resolve => setTimeout(resolve, 2000));
    await processingDelay;

    // Randomly succeed or fail for demo (90% success rate)
    const isSuccess = Math.random() < 0.9;

    if (isSuccess) {
      // Update payment status
      await client.query(
        'UPDATE payments SET status = $1 WHERE id = $2',
        ['completed', paymentId]
      );

      // Create webhook event
      await client.query(
        `INSERT INTO webhook_events (webhook_id, event_type, payload, status)
         SELECT id, $1, $2, $3 FROM webhooks WHERE active = true`,
        ['payment.completed', JSON.stringify({ payment_id: paymentId, amount, email }), 'pending']
      );

      await client.query('COMMIT');
      console.log(`Payment ${paymentId} processed successfully`);
    } else {
      // Update payment status to failed
      await client.query(
        'UPDATE payments SET status = $1 WHERE id = $2',
        ['failed', paymentId]
      );

      // Create webhook event for failure
      await client.query(
        `INSERT INTO webhook_events (webhook_id, event_type, payload, status)
         SELECT id, $1, $2, $3 FROM webhooks WHERE active = true`,
        ['payment.failed', JSON.stringify({ payment_id: paymentId, amount, reason: 'Processing failed' }), 'pending']
      );

      await client.query('COMMIT');
      throw new Error(`Payment ${paymentId} processing failed`);
    }

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Payment processing error:', error);
    throw error;
  } finally {
    client.release();
  }
};

// Start webhook retry processor
const startWebhookRetryProcessor = () => {
  const webhookQueue = new Queue('webhooks', {
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379
    }
  });

  webhookQueue.process(async (job) => {
    return processWebhookEvent(job.data);
  });

  // Process pending webhook events every 30 seconds
  setInterval(async () => {
    try {
      const pendingEvents = await pool.query(
        `SELECT id, webhook_id, event_type, payload, retry_count, max_retries, next_retry
         FROM webhook_events
         WHERE status = 'pending' AND (next_retry IS NULL OR next_retry <= NOW())
         LIMIT 100`
      );

      for (const event of pendingEvents.rows) {
        await webhookQueue.add(event, { jobId: event.id });
      }
    } catch (error) {
      console.error('Error fetching pending webhook events:', error);
    }
  }, 30000);

  return webhookQueue;
};

// Process webhook event
const processWebhookEvent = async (eventData) => {
  const { id: eventId, webhook_id, event_type, payload, retry_count, max_retries } = eventData;

  try {
    // Get webhook details
    const webhookResult = await pool.query(
      'SELECT url, secret FROM webhooks WHERE id = $1',
      [webhook_id]
    );

    if (webhookResult.rows.length === 0) {
      // Mark event as failed if webhook doesn't exist
      await pool.query(
        'UPDATE webhook_events SET status = $1 WHERE id = $2',
        ['failed', eventId]
      );
      return;
    }

    const webhook = webhookResult.rows[0];

    // Send webhook event
    await sendWebhookEvent(event_type, payload, webhook);

    // Mark event as completed
    await pool.query(
      'UPDATE webhook_events SET status = $1 WHERE id = $2',
      ['completed', eventId]
    );

  } catch (error) {
    const newRetryCount = retry_count + 1;

    if (newRetryCount >= max_retries) {
      // Mark as failed after max retries
      await pool.query(
        'UPDATE webhook_events SET status = $1, last_error = $2, retry_count = $3 WHERE id = $4',
        ['failed', error.message, newRetryCount, eventId]
      );
    } else {
      // Schedule retry with exponential backoff
      const backoffSeconds = Math.pow(2, newRetryCount) * 60; // 2^n minutes
      await pool.query(
        'UPDATE webhook_events SET retry_count = $1, next_retry = NOW() + INTERVAL \'1 second\' * $2, last_error = $3 WHERE id = $4',
        [newRetryCount, backoffSeconds, error.message, eventId]
      );
    }
  }
};

module.exports = {
  createPaymentQueue,
  startWebhookRetryProcessor,
  processPayment
};
