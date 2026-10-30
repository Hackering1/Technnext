import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: config.NODE_ENV !== 'production' || config.DB_SSL_MODE === 'disable'
    ? undefined
    : { rejectUnauthorized: config.DB_SSL_MODE === 'verify' }
});

pool.on('error', (error) => {
  console.error(JSON.stringify({ level: 'error', event: 'postgres_pool_error', message: error.message }));
});
