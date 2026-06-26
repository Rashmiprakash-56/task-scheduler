import { Router } from "express";
import pool from "./db.js";
import redis from "../lib/redis.js";
import { PRIORITIES, VALID_TYPES, QUEUE_PREFIX } from "../lib/constants.js";
import logger from "../lib/logger.js";

const router = Router();

// 1. Create a job
router.post("/jobs", async (req, res) => {
  try {
    const { type, payload, priority = "normal", run_at } = req.body;

    if (!type || !VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: `Invalid job type. Must be one of: ${VALID_TYPES.join(", ")}` });
    }

    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ error: "Payload is required and must be an object." });
    }

    if (!["low", "normal", "high"].includes(priority)) {
      return res.status(400).json({ error: "Priority must be low, normal, or high." });
    }

    const priorityInt = PRIORITIES[priority];
    
    let isDelayed = false;
    let scheduledDate = new Date();
    if (run_at) {
      const parsedDate = new Date(run_at);
      if (isNaN(parsedDate.getTime())) {
        return res.status(400).json({ error: "run_at must be a valid ISO 8601 date." });
      }
      scheduledDate = parsedDate;
      if (parsedDate.getTime() > Date.now()) {
        isDelayed = true;
      }
    }

    const status = isDelayed ? "scheduled" : "queued";

    const { rows } = await pool.query(
      "INSERT INTO jobs (type, payload, priority, status, run_at) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [type, JSON.stringify(payload), priorityInt, status, scheduledDate]
    );

    const job = rows[0];

    if (isDelayed) {
      await redis.zadd(`${QUEUE_PREFIX}:delayed`, scheduledDate.getTime(), JSON.stringify({ id: job.id, priority }));
    } else {
      await redis.lpush(`${QUEUE_PREFIX}:${priority}`, job.id);
    }

    logger.info("Created job", { jobId: job.id, type, status });
    return res.status(201).json(job);
  } catch (err) {
    logger.error("Error creating job", { error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// 2. List jobs (with pagination and filtering)
router.get("/jobs", async (req, res) => {
  try {
    const { status, type, priority, page = 1, limit = 20, sort = "created_at", order = "desc" } = req.query;
    
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    let query = "SELECT * FROM jobs WHERE 1=1";
    const values = [];
    let paramIndex = 1;

    if (status) {
      query += ` AND status = $${paramIndex++}`;
      values.push(status);
    }
    if (type) {
      query += ` AND type = $${paramIndex++}`;
      values.push(type);
    }
    if (priority) {
      const pInt = PRIORITIES[priority];
      if (pInt !== undefined) {
        query += ` AND priority = $${paramIndex++}`;
        values.push(pInt);
      }
    }

    const validSorts = ["created_at", "updated_at", "run_at", "priority", "status"];
    const sortField = validSorts.includes(sort) ? sort : "created_at";
    const sortOrder = order.toLowerCase() === "asc" ? "ASC" : "DESC";

    const countQuery = query.replace("SELECT *", "SELECT COUNT(*)");
    const { rows: countRows } = await pool.query(countQuery, values);
    const total = parseInt(countRows[0].count, 10);

    query += ` ORDER BY ${sortField} ${sortOrder} LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    values.push(limitNum, offset);

    const { rows } = await pool.query(query, values);

    return res.json({
      data: rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 3. Get job status
router.get("/jobs/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query("SELECT * FROM jobs WHERE id = $1", [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Job not found." });
    }

    return res.json(rows[0]);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 4. Cancel a job
router.delete("/jobs/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      
      const { rows } = await client.query("SELECT status FROM jobs WHERE id = $1 FOR UPDATE", [id]);
      if (rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Job not found." });
      }
      
      const job = rows[0];
      if (job.status === "running") {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Cannot cancel a running job." });
      }
      
      if (job.status === "succeeded" || job.status === "failed") {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: `Job already finished with status: ${job.status}` });
      }
      
      await client.query(
        "UPDATE jobs SET status = 'cancelled', cancelled = TRUE, updated_at = NOW() WHERE id = $1",
        [id]
      );
      
      await client.query("COMMIT");
      logger.info("Cancelled job", { jobId: id });
      return res.json({ message: "Job cancelled successfully." });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error("Error cancelling job", { error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// 5. Get DLQ
router.get("/dlq", async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    const { rows: countRows } = await pool.query("SELECT COUNT(*) FROM dead_letter_queue");
    const total = parseInt(countRows[0].count, 10);

    const { rows } = await pool.query(
      "SELECT * FROM dead_letter_queue ORDER BY failed_at DESC LIMIT $1 OFFSET $2",
      [limitNum, offset]
    );

    return res.json({
      data: rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 6. Retry DLQ job
router.post("/dlq/:id/retry", async (req, res) => {
  try {
    const { id } = req.params;
    
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      
      const { rows } = await client.query("SELECT * FROM dead_letter_queue WHERE id = $1 FOR UPDATE", [id]);
      if (rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "DLQ entry not found." });
      }
      
      const dlqItem = rows[0];
      const jobId = dlqItem.job_id;
      
      const { rows: jobRows } = await client.query(
        "UPDATE jobs SET status = 'queued', attempts = 0, error = NULL, updated_at = NOW() WHERE id = $1 RETURNING priority",
        [jobId]
      );
      
      if (jobRows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Original job not found." });
      }
      
      await client.query("DELETE FROM dead_letter_queue WHERE id = $1", [id]);
      
      await client.query("COMMIT");
      
      const priorityInt = jobRows[0].priority;
      let priorityStr = "normal";
      if (priorityInt === PRIORITIES.high) priorityStr = "high";
      if (priorityInt === PRIORITIES.low) priorityStr = "low";
      
      await redis.lpush(`${QUEUE_PREFIX}:${priorityStr}`, jobId);
      
      logger.info("Retried DLQ job", { dlqId: id, jobId });
      return res.json({ message: "Job retried successfully." });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error("Error retrying DLQ job", { error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

export default router;
