import test from "node:test";
import assert from "node:assert";
import handlers from "../worker/handlers.js";

test("fibonacci handler", async (t) => {
  await t.test("calculates fibonacci correctly", async () => {
    const result = await handlers.fibonacci({ n: 10 });
    assert.deepStrictEqual(result, { n: 10, result: 55 });
  });

  await t.test("throws on invalid input", async () => {
    await assert.rejects(
      async () => await handlers.fibonacci({ n: -1 }),
      /Invalid payload: n must be a non-negative number./
    );
  });
});

test("sleep handler", async (t) => {
  await t.test("sleeps for specified ms", async () => {
    const start = Date.now();
    const result = await handlers.sleep({ ms: 100 });
    const elapsed = Date.now() - start;
    assert.deepStrictEqual(result, { ms: 100, slept: true });
    assert.ok(elapsed >= 90);
  });
});

test("email handler", async (t) => {
  await t.test("simulates sending email", async () => {
    const result = await handlers.email({ to: "test@example.com", subject: "Hello", body: "World" });
    assert.deepStrictEqual(result, { to: "test@example.com", sent: true });
  });

  await t.test("throws on missing fields", async () => {
    await assert.rejects(
      async () => await handlers.email({ to: "test@example.com" }),
      /Invalid payload: to, subject, and body are required./
    );
  });
});

test("webhook handler", async (t) => {
  await t.test("simulates webhook call", async () => {
    const result = await handlers.webhook({ url: "http://example.com", data: {} });
    assert.deepStrictEqual(result, { url: "http://example.com", success: true });
  });
});
