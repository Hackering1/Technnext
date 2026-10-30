import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import pg from 'pg';
import { seal, hashApiKey } from '../src/crypto.js';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const slug = required('TENANT_SLUG').toLowerCase();
if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug)) throw new Error('TENANT_SLUG must be a short lowercase slug');
const name = required('TENANT_NAME');
const provider = required('TENANT_PROVIDER').toLowerCase();
const environment = (process.env.TENANT_ENVIRONMENT || 'test').toLowerCase();
const returnHosts = required('TENANT_RETURN_HOSTS').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
if (!returnHosts.length) throw new Error('TENANT_RETURN_HOSTS must contain at least one host');
if (returnHosts.some((host) => isIP(host) || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host))) {
  throw new Error('TENANT_RETURN_HOSTS must contain public DNS hostnames without ports or paths');
}
const keyId = randomUUID();
const apiKey = `tnp_live_${keyId}.${randomBytes(32).toString('base64url')}`;
const providerId = randomUUID();
let credentials;
if (provider === 'razorpay') {
  credentials = { keyId: required('RAZORPAY_KEY_ID'), keySecret: required('RAZORPAY_KEY_SECRET'), webhookSecret: required('RAZORPAY_WEBHOOK_SECRET') };
} else if (provider === 'cashfree') {
  credentials = { clientId: required('CASHFREE_CLIENT_ID'), clientSecret: required('CASHFREE_CLIENT_SECRET'), webhookSecret: required('CASHFREE_WEBHOOK_SECRET'), apiVersion: required('CASHFREE_API_VERSION') };
} else throw new Error('TENANT_PROVIDER must be razorpay or cashfree');

const pool = new pg.Pool({ connectionString: required('DATABASE_URL') });
try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tenant = await client.query(
      'INSERT INTO tenants (id, slug, name, return_hosts) VALUES ($1,$2,$3,$4) RETURNING id',
      [randomUUID(), slug, name, returnHosts]
    );
    await client.query(
      'INSERT INTO provider_accounts (id, tenant_id, provider, environment, encrypted_credentials) VALUES ($1,$2,$3,$4,$5)',
      [providerId, tenant.rows[0].id, provider, environment, seal(credentials)]
    );
    await client.query(
      'INSERT INTO api_keys (id, tenant_id, key_hash, label) VALUES ($1,$2,$3,$4)',
      [keyId, tenant.rows[0].id, hashApiKey(apiKey), process.env.TENANT_KEY_LABEL || 'primary']
    );
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  console.log(`Tenant provisioned: ${slug}`);
  console.log('Save this API key in the calling product secret manager now; it is shown only once:');
  console.log(apiKey);
} finally { await pool.end(); }

