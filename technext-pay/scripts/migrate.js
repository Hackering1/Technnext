import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const sql = await readFile(new URL('../db/migrations/001_initial.sql', import.meta.url), 'utf8');
  await pool.query(sql);
  console.log('TechNext Pay schema is up to date.');
} finally { await pool.end(); }

