import redis from "./redis.js";
import logger from "./logger.js";

export class CircuitBreakerOpenError extends Error {
  constructor(message) {
    super(message);
    this.name = "CircuitBreakerOpenError";
  }
}

/**
 * Fires an action through a distributed Circuit Breaker.
 * @param {string} name - The unique name for the circuit breaker (e.g. "webhook")
 * @param {number} threshold - Number of failures before tripping
 * @param {number} timeoutMs - How long the circuit stays open before half-open state
 * @param {Function} action - The async function to execute
 */
export async function fireWithCircuitBreaker(name, threshold, timeoutMs, action) {
  const failureKey = `cb:${name}:failures`;
  const openKey = `cb:${name}:open_until`;

  const openUntilStr = await redis.get(openKey);
  if (openUntilStr) {
    const openUntil = parseInt(openUntilStr, 10);
    if (Date.now() < openUntil) {
      throw new CircuitBreakerOpenError(`Circuit Breaker for '${name}' is OPEN.`);
    }
  }

  try {
    const result = await action();
    await redis.del(failureKey, openKey);
    return result;
  } catch (err) {
    const failures = await redis.incr(failureKey);
    
    if (failures === 1) {
      await redis.expire(failureKey, Math.ceil(timeoutMs / 1000) * 2);
    }

    if (failures >= threshold) {
      const openUntil = Date.now() + timeoutMs;
      await redis.set(openKey, openUntil, "PX", timeoutMs);
      logger.error(`Circuit Breaker '${name}' TRIPPED. Open for ${timeoutMs}ms.`);
    }

    throw err;
  }
}
