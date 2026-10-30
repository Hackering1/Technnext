import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  for (const migration of ['001_initial.sql', '002_outbox.sql']) {
    const sql = await readFile(new URL(`../db/migrations/${migration}`, import.meta.url), 'utf8');
    await pool.query(sql);
  }
  console.log('TechNext Pay schema is up to date.');
} finally { await pool.end(); }
