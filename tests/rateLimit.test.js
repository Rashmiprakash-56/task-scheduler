import test from "node:test";
import assert from "node:assert";
import { rateLimit } from "../app/rateLimit.js";
import redis from "../lib/redis.js";

test("rate limiter", async (t) => {
  const ip = "127.0.0.1";
  await redis.del(`ratelimit:${ip}`);

  let statusCodes = [];
  
  for (let i = 0; i < 25; i++) {
    const req = { ip };
    const res = {
      setHeader: () => {},
      status: (code) => {
        statusCodes.push(code);
        return { json: () => {} };
      }
    };
    
    let nextCalled = false;
    const next = () => { nextCalled = true; };
    
    await rateLimit(req, res, next);
    if (nextCalled) {
      statusCodes.push(200); // Simulate success if next is called
    }
  }

  // The first 20 should be 200, the next 5 should be 429
  assert.strictEqual(statusCodes.filter(c => c === 200).length, 20);
  assert.strictEqual(statusCodes.filter(c => c === 429).length, 5);
  
  await redis.quit();
});
