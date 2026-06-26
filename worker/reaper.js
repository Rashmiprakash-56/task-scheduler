import redis from "../lib/redis.js";
import pool from "../app/db.js";
import logger from "../lib/logger.js";
import { PRIORITIES } from "../lib/constants.js";

let isShuttingDown = false;

export function stopReaper() {
  isShuttingDown = true;
}

export async function startReaper() {
  logger.info("Reaper started, watching for stale jobs...");
  
  while (!isShuttingDown) {
    try {
      const { rows } = await pool.query(`
        SELECT id, priority, attempts 
        FROM jobs 
        WHERE status = 'running' 
        AND locked_at < NOW() - INTERVAL '2 minutes'
      `);
      
      for (const job of rows) {
        const newAttempts = job.attempts + 1;
        await pool.query(`
          UPDATE jobs 
          SET status = 'queued', 
              locked_by = NULL, 
              locked_at = NULL,
              attempts = $1,
              updated_at = NOW() 
          WHERE id = $2
        `, [newAttempts, job.id]);
        
        let priorityStr = "normal";
        if (job.priority === PRIORITIES.high) priorityStr = "high";
        if (job.priority === PRIORITIES.low) priorityStr = "low";

        const queueName = `jobs:${priorityStr}`;
        await redis.lpush(queueName, job.id);
        
        logger.warn("Recovered stale job", { jobId: job.id, newAttempts, queueName });
      }
    } catch (err) {
      logger.error("Reaper error", { error: err.message });
    }
    
    // Delay for 30s but check isShuttingDown frequently to allow fast exit
    for (let i = 0; i < 30 && !isShuttingDown; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
