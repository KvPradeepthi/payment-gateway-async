backend/src/index.jsrequire('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { Pool } = require('pg');
const Redis = require('redis');
const Queue = require('bull');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Redis connection
const redisClient = Redis.createClient({
  url: process.env.REDIS_URL,
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));
redisClient.connect();

// Job queues
const paymentQueue = new Queue('payments', process.env.REDIS_URL);
const webhookQueue = new Queue('webhooks', process.env.REDIS_URL);
const refundQueue = new Queue('refunds', process.env.REDIS_URL);

// Health check endpoints
app.get('/api/v1/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({
      status: 'healthy',
      database: 'connected',
      redis: redisClient.isReady ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

app.get('/api/v1/health/db', async (req, res) => {
  try {
    await pool.query('SELECT NOW()');
    res.json({ status: 'healthy', service: 'database' });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', error: error.message });
  }
});

app.get('/api/v1/health/redis', async (req, res) => {
  try {
    await redisClient.ping();
    res.json({ status: 'healthy', service: 'redis' });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', error: error.message });
  }
});

// Test job status endpoint
app.get('/api/v1/test/jobs/status', async (req, res) => {
  try {
    const paymentCounts = await paymentQueue.getJobCounts();
    const webhookCounts = await webhookQueue.getJobCounts();
    const refundCounts = await refundQueue.getJobCounts();

    res.json({
      pending: paymentCounts.waiting + webhookCounts.waiting + refundCounts.waiting,
      processing: paymentCounts.active + webhookCounts.active + refundCounts.active,
      completed: paymentCounts.completed + webhookCounts.completed + refundCounts.completed,
      failed: paymentCounts.failed + webhookCounts.failed + refundCounts.failed,
      worker_status: 'running'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      description: err.message
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Payment Gateway API server running on port ${PORT}`);
  console.log(`Database: ${process.env.DATABASE_URL}`);
  console.log(`Redis: ${process.env.REDIS_URL}`);
});

module.exports = { app, pool, redisClient, paymentQueue, webhookQueue, refundQueue };
