import { Router } from "express";
import pool from "./db.js";
import redis from "../lib/redis.js";

const router = Router();

router.get("/metrics", async (req, res) => {
  try {
    const { rows: jobStats } = await pool.query(`
      SELECT status, COUNT(*) as count 
      FROM jobs 
      GROUP BY status
    `);
    
    const { rows: typeStats } = await pool.query(`
      SELECT type, COUNT(*) as count 
      FROM jobs 
      GROUP BY type
    `);

    const { rows: dlqStats } = await pool.query(`
      SELECT COUNT(*) as count FROM dead_letter_queue
    `);
    
    let metricsText = "";
    
    metricsText += "# HELP jobs_total Total jobs by status\n";
    metricsText += "# TYPE jobs_total gauge\n";
    for (const row of jobStats) {
      metricsText += `jobs_total{status="${row.status}"} ${row.count}\n`;
    }

    metricsText += "# HELP jobs_by_type Total jobs by type\n";
    metricsText += "# TYPE jobs_by_type gauge\n";
    for (const row of typeStats) {
      metricsText += `jobs_by_type{type="${row.type}"} ${row.count}\n`;
    }

    const dlqCount = dlqStats[0]?.count || 0;
    metricsText += "# HELP jobs_dlq_total Total jobs in dead letter queue\n";
    metricsText += "# TYPE jobs_dlq_total gauge\n";
    metricsText += `jobs_dlq_total ${dlqCount}\n`;

    const highLen = await redis.llen("jobs:high");
    const normalLen = await redis.llen("jobs:normal");
    const lowLen = await redis.llen("jobs:low");
    const delayedCount = await redis.zcard("jobs:delayed");

    metricsText += "# HELP redis_queue_length Number of jobs in redis queues\n";
    metricsText += "# TYPE redis_queue_length gauge\n";
    metricsText += `redis_queue_length{queue="high"} ${highLen}\n`;
    metricsText += `redis_queue_length{queue="normal"} ${normalLen}\n`;
    metricsText += `redis_queue_length{queue="low"} ${lowLen}\n`;
    metricsText += `redis_queue_length{queue="delayed"} ${delayedCount}\n`;

    res.set("Content-Type", "text/plain");
    return res.send(metricsText);
  } catch (err) {
    return res.status(500).send(`Error generating metrics: ${err.message}`);
  }
});

export default router;
