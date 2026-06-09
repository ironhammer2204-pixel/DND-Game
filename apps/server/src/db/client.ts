import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn("WARNING: DATABASE_URL is not set in environment variables.");
}

const cleanConnectionString = connectionString?.replace(/[?&]sslmode=[^&]+/g, "");
const isLocal = connectionString?.includes("localhost") || connectionString?.includes("127.0.0.1") || connectionString?.includes("::1");

export const pool = new Pool({
  connectionString: cleanConnectionString,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle database client", err);
});

