function formatLog(level, message, context = {}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  };
  
  if (process.env.WORKER_ID) {
    logEntry.workerId = process.env.WORKER_ID;
  }
  
  return JSON.stringify(logEntry);
}

export const logger = {
  info: (message, context) => console.log(formatLog("info", message, context)),
  warn: (message, context) => console.warn(formatLog("warn", message, context)),
  error: (message, context) => console.error(formatLog("error", message, context)),
};

export default logger;
