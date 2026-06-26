import Redis from "ioredis";
import logger from "./logger.js";

export function createRedisClient() {
  const client = new Redis({
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    retryStrategy(times) {
      const delay = Math.min(times * 500, 5000);
      return delay;
    },
  });

  client.on("error", (err) => {
    logger.error("Redis error", { error: err.message });
  });

  return client;
}

export const redis = createRedisClient();
export default redis;
