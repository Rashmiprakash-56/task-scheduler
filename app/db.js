import { Pool } from "pg";

const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  port: parseInt(process.env.PGPORT, 10) || 5432,
  user: process.env.PGUSER || "scheduler",
  password: process.env.PGPASSWORD || "scheduler",
  database: process.env.PGDATABASE || "scheduler",
});

export default pool;
