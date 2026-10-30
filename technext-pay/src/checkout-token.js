import { createHmac } from 'node:crypto';
import { config } from './config.js';
import { safeEqual } from './crypto.js';

const TOKEN_TTL_SECONDS = 24 * 60 * 60;

export function createCheckoutToken(orderId) {
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const signature = createHmac('sha256', config.API_KEY_PEPPER)
    .update(`technext-checkout:${orderId}:${expiresAt}`)
    .digest('base64url');
  return `${orderId}.${expiresAt}.${signature}`;
}

export function readCheckoutToken(value) {
  const match = /^([0-9a-f-]{36})\.(\d{10})\.([A-Za-z0-9_-]{43})$/i.exec(value || '');
  if (!match) return null;
  const [, orderId, expiryText, suppliedSignature] = match;
  const expiresAt = Number(expiryText);
  if (expiresAt < Math.floor(Date.now() / 1000)) return null;
  const expected = createHmac('sha256', config.API_KEY_PEPPER)
    .update(`technext-checkout:${orderId}:${expiresAt}`)
    .digest('base64url');
  return safeEqual(expected, suppliedSignature) ? orderId : null;
}

