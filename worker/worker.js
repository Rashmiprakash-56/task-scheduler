import os from "os";
import pool from "../app/db.js";
import handlers from "./handlers.js";
import redis from "../lib/redis.js";
import logger from "../lib/logger.js";
import { QUEUE_PREFIX, MAX_ATTEMPTS } from "../lib/constants.js";
import { startScheduler, stopScheduler } from "./scheduler.js";
import { startReaper, stopReaper } from "./reaper.js";
import { fireWithCircuitBreaker, CircuitBreakerOpenError } from "../lib/circuitBreaker.js";

const WORKER_ID = `worker-${os.hostname()}-${process.pid}`;
process.env.WORKER_ID = WORKER_ID; // for logger

let isShuttingDown = false;

async function processJob(jobId, queueName) {
  const client = await pool.connect();
  
  try {
    await client.query("BEGIN");
    
    // Lock the job
    const { rows } = await client.query(
      "SELECT * FROM jobs WHERE id = $1 FOR UPDATE SKIP LOCKED", 
      [jobId]
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return;
    }

    const job = rows[0];

    if (job.cancelled) {
      await client.query("ROLLBACK");
      logger.info("Skipping cancelled job", { jobId });
      return;
    }

    const handler = handlers[job.type];
    if (!handler) {
      await client.query(
        "UPDATE jobs SET status = 'failed', error = $1, updated_at = NOW() WHERE id = $2",
        [`Unknown job type: ${job.type}`, jobId]
      );
      await client.query("COMMIT");
      return;
    }

    await client.query(
      "UPDATE jobs SET status = 'running', locked_by = $1, locked_at = NOW(), updated_at = NOW() WHERE id = $2",
      [WORKER_ID, jobId]
    );
    await client.query("COMMIT");

    try {
      const result = await fireWithCircuitBreaker(job.type, 5, 30000, async () => {
        return await handler(job.payload);
      });
      
      await pool.query(
        "UPDATE jobs SET status = 'succeeded', result = $1, locked_by = NULL, locked_at = NULL, updated_at = NOW() WHERE id = $2",
        [JSON.stringify(result), jobId]
      );
      logger.info("Job succeeded", { jobId });
    } catch (err) {
      if (err.name === "CircuitBreakerOpenError") {
        const delayDate = new Date(Date.now() + 30000);
        await pool.query(
          "UPDATE jobs SET status = 'scheduled', run_at = $1, locked_by = NULL, locked_at = NULL, updated_at = NOW() WHERE id = $2",
          [delayDate, jobId]
        );
        await redis.zadd(`${QUEUE_PREFIX}:delayed`, delayDate.getTime(), JSON.stringify({ id: jobId, priority: job.priority }));
        logger.warn("Circuit OPEN, job delayed for 30s", { jobId, type: job.type });
        return;
      }

      const newAttempts = job.attempts + 1;

      if (newAttempts < MAX_ATTEMPTS) {
        await pool.query(
          "UPDATE jobs SET status = 'queued', attempts = $1, error = $2, locked_by = NULL, locked_at = NULL, updated_at = NOW() WHERE id = $3",
          [newAttempts, err.message, jobId]
        );
        // Requeue
        await redis.lpush(queueName, jobId);
        logger.warn("Job failed, requeued", { jobId, attempt: newAttempts, max: MAX_ATTEMPTS, error: err.message });
      } else {
        await pool.query(
          "UPDATE jobs SET status = 'failed', attempts = $1, error = $2, locked_by = NULL, locked_at = NULL, updated_at = NOW() WHERE id = $3",
          [newAttempts, err.message, jobId]
        );
        
        // Insert into DLQ
        await pool.query(
          "INSERT INTO dead_letter_queue (job_id, type, payload, error, attempts) VALUES ($1, $2, $3, $4, $5)",
          [jobId, job.type, JSON.stringify(job.payload), err.message, newAttempts]
        );
        
        logger.error("Job failed permanently, moved to DLQ", { jobId, attempt: newAttempts });
      }
    }
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("Database error processing job", { error: err.message, jobId });
  } finally {
    client.release();
  }
}

async function run() {
  logger.info("Worker started, waiting for jobs...", { workerId: WORKER_ID });
  
  // Start background processes
  startScheduler();
  startReaper();

  while (!isShuttingDown) {
    try {
      const result = await redis.brpop(
        `${QUEUE_PREFIX}:high`, 
        `${QUEUE_PREFIX}:normal`, 
        `${QUEUE_PREFIX}:low`, 
        2
      );

      if (result) {
        const queueName = result[0];
        const jobId = result[1];
        logger.info("Picked up job", { jobId, queueName });
        await processJob(jobId, queueName);
      }
    } catch (err) {
      logger.error("Worker loop error", { error: err.message });
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  
  logger.info("Worker exited main loop");
}

async function shutdown() {
  logger.info("Graceful shutdown initiated...");
  isShuttingDown = true;
  stopScheduler();
  stopReaper();
  
  setTimeout(async () => {
    logger.info("Force closing connections...");
    await redis.quit();
    await pool.end();
    process.exit(0);
  }, 5000);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

run().catch((err) => {
  logger.error("Worker fatal error", { error: err.message });
  process.exit(1);
});
