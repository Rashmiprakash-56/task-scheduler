import redis from "../lib/redis.js";
import pool from "../app/db.js";
import logger from "../lib/logger.js";

let isShuttingDown = false;

export function stopScheduler() {
  isShuttingDown = true;
}

export async function startScheduler() {
  logger.info("Scheduler started, watching for delayed jobs...");
  
  while (!isShuttingDown) {
    try {
      const now = Date.now();
      const delayed = await redis.zrangebyscore("jobs:delayed", "-inf", now, "LIMIT", 0, 10);
      
      for (const item of delayed) {
        const { id, priority } = JSON.parse(item);
        const queueName = `jobs:${priority}`;
        
        const multi = redis.multi();
        multi.zrem("jobs:delayed", item);
        multi.lpush(queueName, id);
        const results = await multi.exec();
        
        if (results && results[0][1] === 1) {
          await pool.query(
            "UPDATE jobs SET status = 'queued', updated_at = NOW() WHERE id = $1",
            [id]
          );
          logger.info("Promoted delayed job", { jobId: id, queueName });
        }
      }
    } catch (err) {
      logger.error("Scheduler error", { error: err.message });
    }
    
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
