import express from "express";
import routes from "./routes.js";
import metrics from "./metrics.js";
import { rateLimit } from "./rateLimit.js";
import logger from "../lib/logger.js";

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;

// Mount metrics without rate limiting
app.use(metrics);

app.use(express.json());
app.use(rateLimit);
app.use(routes);

app.listen(PORT, () => {
  logger.info(`API server listening on port ${PORT}`);
});
