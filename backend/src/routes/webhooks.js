const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');

const router = express.Router();

// Generate webhook secret
const generateSecret = () => crypto.randomBytes(32).toString('hex');

// POST /webhooks - Register a new webhook
router.post('/', async (req, res) => {
  try {
    const { url, events } = req.body;

    // Validation
    if (!url) {
      return res.status(400).json({ error: 'Webhook URL is required' });
    }
    if (!events || !Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'Events array is required' });
    }

    const webhookId = uuidv4();
    const secret = generateSecret();

    const result = await pool.query(
      `INSERT INTO webhooks (id, url, events, secret, active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, url, events, active, created_at`,
      [webhookId, url, JSON.stringify(events), secret, true]
    );

    res.status(201).json({
      ...result.rows[0],
      secret: secret
    });

  } catch (error) {
    console.error('Webhook creation error:', error);
    res.status(500).json({ error: 'Webhook registration failed' });
  }
});

// GET /webhooks - List all webhooks
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, url, events, active, created_at FROM webhooks ORDER BY created_at DESC'
    );

    res.json(result.rows);

  } catch (error) {
    console.error('Webhook list error:', error);
    res.status(500).json({ error: 'Failed to retrieve webhooks' });
  }
});

// GET /webhooks/:id - Get webhook details
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT id, url, events, active, created_at FROM webhooks WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error('Webhook retrieval error:', error);
    res.status(500).json({ error: 'Failed to retrieve webhook' });
  }
});

// POST /webhooks/:id/events - Query webhook events
router.get('/:id/events', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, limit = 50, offset = 0 } = req.query;

    // Verify webhook exists
    const webhookCheck = await pool.query(
      'SELECT id FROM webhooks WHERE id = $1',
      [id]
    );

    if (webhookCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    let query = 'SELECT * FROM webhook_events WHERE webhook_id = $1';
    const params = [id];

    if (status) {
      query += ' AND status = $' + (params.length + 1);
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM webhook_events WHERE webhook_id = $1';
    const countParams = [id];

    if (status) {
      countQuery += ' AND status = $' + (countParams.length + 1);
      countParams.push(status);
    }

    const countResult = await pool.query(countQuery, countParams);

    res.json({
      events: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

  } catch (error) {
    console.error('Webhook events retrieval error:', error);
    res.status(500).json({ error: 'Failed to retrieve webhook events' });
  }
});

// PATCH /webhooks/:id - Update webhook
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { active, events, url } = req.body;

    const updates = [];
    const params = [];
    let paramCount = 1;

    if (active !== undefined) {
      updates.push(`active = $${paramCount}`);
      params.push(active);
      paramCount++;
    }

    if (events) {
      updates.push(`events = $${paramCount}`);
      params.push(JSON.stringify(events));
      paramCount++;
    }

    if (url) {
      updates.push(`url = $${paramCount}`);
      params.push(url);
      paramCount++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    params.push(id);

    const result = await pool.query(
      `UPDATE webhooks SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramCount} RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error('Webhook update error:', error);
    res.status(500).json({ error: 'Failed to update webhook' });
  }
});

// DELETE /webhooks/:id - Delete webhook
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM webhooks WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    res.json({ message: 'Webhook deleted successfully' });

  } catch (error) {
    console.error('Webhook deletion error:', error);
    res.status(500).json({ error: 'Failed to delete webhook' });
  }
});

module.exports = router;
