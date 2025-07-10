import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { Database } from '../models/postgres';

// Create a PostgreSQL pool
const pool = new Pool({
  host: process.env['DB_HOST'] || 'localhost',
  port: parseInt(process.env['DB_PORT'] || '5432'),
  user: process.env['DB_USER'] || 'admin',
  password: process.env['DB_PASSWORD'] || 'password',
  database: process.env['DB_NAME'] || 'db0',
  max: 10, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
});

// Create the Kysely instance
export const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool,
  }),
});

// Export the pool for manual connection management if needed
export { pool };

// Graceful shutdown
process.on('SIGINT', async () => {
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
}); 