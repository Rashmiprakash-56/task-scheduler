import test from "node:test";
import assert from "node:assert";
import { fireWithCircuitBreaker, CircuitBreakerOpenError } from "../lib/circuitBreaker.js";
import redis from "../lib/redis.js";

test("Circuit Breaker", async (t) => {
  const cbName = "test-webhook";
  
  await redis.del(`cb:${cbName}:failures`, `cb:${cbName}:open_until`);

  await t.test("executes successfully and keeps circuit closed", async () => {
    const result = await fireWithCircuitBreaker(cbName, 3, 1000, async () => {
      return "success";
    });
    assert.strictEqual(result, "success");
  });

  await t.test("trips circuit after threshold reached", async () => {
    let executionCount = 0;
    
    for (let i = 0; i < 3; i++) {
      await assert.rejects(
        async () => {
          await fireWithCircuitBreaker(cbName, 3, 5000, async () => {
            executionCount++;
            throw new Error("Simulated failure");
          });
        },
        /Simulated failure/
      );
    }
    
    assert.strictEqual(executionCount, 3);

    await assert.rejects(
      async () => {
        await fireWithCircuitBreaker(cbName, 3, 5000, async () => {
          executionCount++; // should not be reached
          throw new Error("Simulated failure");
        });
      },
      (err) => err instanceof CircuitBreakerOpenError
    );
    
    assert.strictEqual(executionCount, 3);
  });
  
  await t.test("allows retry after timeout (half-open to closed)", async () => {
    const shortCbName = "short-timeout-cb";
    await redis.del(`cb:${shortCbName}:failures`, `cb:${shortCbName}:open_until`);
    
    await assert.rejects(
      async () => {
        await fireWithCircuitBreaker(shortCbName, 1, 100, async () => {
          throw new Error("Fail once");
        });
      }
    );
    
    await assert.rejects(
      async () => {
        await fireWithCircuitBreaker(shortCbName, 1, 100, async () => {
          return "success";
        });
      },
      CircuitBreakerOpenError
    );
    
    await new Promise(resolve => setTimeout(resolve, 150));
    
    const result = await fireWithCircuitBreaker(shortCbName, 1, 100, async () => {
      return "recovered";
    });
    
    assert.strictEqual(result, "recovered");
  });

  await redis.quit();
});
