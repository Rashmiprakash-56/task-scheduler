import test from "node:test";
import assert from "node:assert";

const BASE_URL = "http://localhost:3000";

test("API Integration Tests", async (t) => {
  let createdJobId;

  await t.test("POST /jobs - create a valid job", async () => {
    const res = await fetch(`${BASE_URL}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "sleep",
        payload: { ms: 100 },
        priority: "high"
      })
    });
    
    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.ok(data.id);
    assert.strictEqual(data.status, "queued");
    assert.strictEqual(data.priority, 2);
    
    createdJobId = data.id;
  });

  await t.test("GET /jobs/:id - retrieve job", async () => {
    const res = await fetch(`${BASE_URL}/jobs/${createdJobId}`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.id, createdJobId);
  });

  await t.test("GET /jobs - pagination and filtering", async () => {
    const res = await fetch(`${BASE_URL}/jobs?type=sleep&limit=5`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.data));
    assert.ok(data.pagination);
    assert.strictEqual(data.pagination.limit, 5);
  });
  
  await t.test("DELETE /jobs/:id - cancel a queued job", async () => {
    const createRes = await fetch(`${BASE_URL}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "sleep",
        payload: { ms: 100 },
        run_at: new Date(Date.now() + 60000).toISOString()
      })
    });
    const { id } = await createRes.json();
    
    const cancelRes = await fetch(`${BASE_URL}/jobs/${id}`, { method: "DELETE" });
    assert.strictEqual(cancelRes.status, 200);
    
    const getRes = await fetch(`${BASE_URL}/jobs/${id}`);
    const getBody = await getRes.json();
    assert.strictEqual(getBody.status, "cancelled");
    assert.strictEqual(getBody.cancelled, true);
  });

  await t.test("GET /metrics - fetch prometheus metrics", async () => {
    const res = await fetch(`${BASE_URL}/metrics`);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes("jobs_total"));
    assert.ok(text.includes("redis_queue_length"));
  });
});
