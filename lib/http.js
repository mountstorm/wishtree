// Glue between Node's (req, res) — as used by Vercel functions and the dev
// server — and the plain request/response objects of lib/wishes.js.

import { createWishService, MAX_BODY } from './wishes.js';
import { upstashRedis } from './redis.js';

let service = null;

/** The service for this deployment, configured from environment variables. */
export function serviceFromEnv(env = process.env) {
  if (service) return service;
  const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token, ADMIN_TOKEN: adminToken, RATE_LIMIT_SALT: salt } = env;
  if (!url || !token) console.error('wishtree: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are not set');
  service = createWishService({
    redis: url && token ? upstashRedis({ url, token }) : null,
    adminToken: adminToken || '',
    salt: salt || url || '',
  });
  return service;
}

export function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(req.headers['x-real-ip'] || '') || req.socket?.remoteAddress || '';
}

/** Reads a Node request into { method, headers, ip, body, tooLarge }. */
export async function fromNode(req) {
  const out = { method: req.method, headers: req.headers, ip: clientIp(req), body: undefined, tooLarge: false };
  if (req.method !== 'POST') return out;
  if (req.body !== undefined) {
    // Vercel has already parsed the body.
    out.body = req.body;
    return out;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      out.tooLarge = true;
      return out;
    }
    chunks.push(chunk);
  }
  out.body = Buffer.concat(chunks).toString('utf8');
  return out;
}

export function send(res, { status, headers, body }, method = 'GET') {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(method === 'HEAD' ? undefined : JSON.stringify(body));
}
