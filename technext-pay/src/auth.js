import { pool } from './db.js';
import { hashApiKey, safeEqual } from './crypto.js';

export async function authenticateTenant(req, res, next) {
  try {
    const match = /^Bearer (tnp_live_[a-f0-9-]{36}\.[A-Za-z0-9_-]{40,})$/.exec(req.get('authorization') || '');
    if (!match) return res.status(401).json({ error: 'unauthorized' });
    const token = match[1];
    const [keyId] = token.slice('tnp_live_'.length).split('.');
    const result = await pool.query(
      `SELECT k.key_hash, t.id AS tenant_id, t.slug, t.name
       FROM api_keys k JOIN tenants t ON t.id = k.tenant_id
       WHERE k.id = $1 AND k.revoked_at IS NULL AND t.active = TRUE`, [keyId]
    );
    const row = result.rows[0];
    if (!row || !safeEqual(hashApiKey(token), row.key_hash, 'hex')) return res.status(401).json({ error: 'unauthorized' });
    req.tenant = { id: row.tenant_id, slug: row.slug, name: row.name };
    req.apiKeyId = keyId;
    return next();
  } catch (error) { return next(error); }
}

