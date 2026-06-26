import redis from "../lib/redis.js";
import logger from "../lib/logger.js";

const RATE_LIMIT_WINDOW = 60; // 60 seconds
const MAX_REQUESTS = 20;

export async function rateLimit(req, res, next) {
  try {
    const ip = req.ip || req.connection.remoteAddress || "unknown";
    const key = `ratelimit:${ip}`;
    
    const current = await redis.incr(key);
    
    if (current === 1) {
      await redis.expire(key, RATE_LIMIT_WINDOW);
    }
    
    res.setHeader("X-RateLimit-Limit", MAX_REQUESTS);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, MAX_REQUESTS - current));

    if (current > MAX_REQUESTS) {
      const ttl = await redis.ttl(key);
      res.setHeader("Retry-After", ttl > 0 ? ttl : RATE_LIMIT_WINDOW);
      logger.warn("Rate limit exceeded", { ip });
      return res.status(429).json({ error: "Too Many Requests" });
    }
    
    next();
  } catch (err) {
    logger.error("Rate limiter error", { error: err.message });
    // Fail open if Redis is down
    next();
  }
}
