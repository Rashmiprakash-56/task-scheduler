function fibonacci(n) {
  if (n <= 0) return 0;
  if (n === 1) return 1;
  let a = 0;
  let b = 1;
  for (let i = 2; i <= n; i++) {
    const temp = a + b;
    a = b;
    b = temp;
  }
  return b;
}

async function handleFibonacci(payload) {
  const n = payload.n;
  if (typeof n !== "number" || n < 0) {
    throw new Error("Invalid payload: n must be a non-negative number.");
  }
  const result = fibonacci(n);
  return { n, result };
}

async function handleSleep(payload) {
  const ms = payload.ms;
  if (typeof ms !== "number" || ms < 0) {
    throw new Error("Invalid payload: ms must be a non-negative number.");
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
  return { ms, slept: true };
}

async function handleEmail(payload) {
  const { to, subject, body } = payload;
  if (!to || !subject || !body) {
    throw new Error("Invalid payload: to, subject, and body are required.");
  }
  // Simulate sending email
  await new Promise((resolve) => setTimeout(resolve, 500));
  return { to, sent: true };
}

async function handleWebhook(payload) {
  const { url, data } = payload;
  if (!url || !data) {
    throw new Error("Invalid payload: url and data are required.");
  }
  // Simulate calling webhook
  await new Promise((resolve) => setTimeout(resolve, 800));
  return { url, success: true };
}

const handlers = {
  fibonacci: handleFibonacci,
  sleep: handleSleep,
  email: handleEmail,
  webhook: handleWebhook,
};

export default handlers;
