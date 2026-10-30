import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  DB_SSL_MODE: z.enum(['verify', 'require', 'disable']).default('verify'),
  REDIS_URL: z.string().url(),
  PUBLIC_BASE_URL: z.string().url(),
  FRONTEND_BASE_URL: z.string().url().default('https://technext-pay-frontend.onrender.com'),
  API_KEY_PEPPER: z.string().min(32),
  DATA_ENCRYPTION_KEY: z.string().min(40),
  ALLOWED_ORIGINS: z.string().default(''),
  TRUST_PROXY: z.enum(['true', 'false']).default('false')
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const names = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
  throw new Error(`Invalid environment configuration: ${names}`);
}

export const config = {
  ...parsed.data,
  allowedOrigins: parsed.data.ALLOWED_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean),
  trustProxy: parsed.data.TRUST_PROXY === 'true'
};
const publicBase = new URL(config.PUBLIC_BASE_URL);
if (publicBase.username || publicBase.password || (config.NODE_ENV === 'production' && publicBase.protocol !== 'https:')) {
  throw new Error('PUBLIC_BASE_URL must be HTTPS in production and must not contain credentials');
}

