// The wish API as plain functions: request in, response out. The Vercel
// functions in /api and the local dev server are thin wrappers around these.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { validateWish, MESSAGES } from './validate.js';

export const LIMIT = 400; // wishes returned by GET (the jar shows at most 400)
export const RATE_LIMIT = 3; // wishes per IP...
export const RATE_WINDOW = 3600; // ...per hour, in seconds
export const MAX_BODY = 8 * 1024;

export const KEYS = {
  index: 'wishtree:index', // sorted set: wish id scored by creation time
  data: 'wishtree:wishes', // hash: wish id -> JSON
  rate: (who) => `wishtree:rate:${who}`, // counter per hashed IP, expires hourly
};

const UNAVAILABLE = 'The jar is resting right now. Please try again in a moment.';

const json = (status, body, headers = {}) => ({
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  body,
});
const failure = (status, code, message, headers, extra = {}) => json(status, { error: { code, message, ...extra } }, headers);

/**
 * @param {{redis: {pipeline: Function, transaction: Function} | null,
 *          adminToken?: string, salt?: string, now?: () => number,
 *          newId?: (ms: number) => string, log?: (...args) => void}} deps
 */
export function createWishService({ redis, adminToken = '', salt = '', now = () => Date.now(), newId, log = console.error }) {
  const makeId = newId || ((ms) => `${ms.toString(36)}-${randomBytes(5).toString('hex')}`);
  // IPs are never stored, only a salted hash used as a rate-limit key.
  const who = (ip) => createHash('sha256').update(`${salt}|${ip || 'unknown'}`).digest('hex').slice(0, 32);

  async function list() {
    const [ids, total] = await redis.pipeline([['ZRANGE', KEYS.index, -LIMIT, -1], ['ZCARD', KEYS.index]]);
    if (!ids.length) return { wishes: [], total: Number(total) };
    const [values] = await redis.pipeline([['HMGET', KEYS.data, ...ids]]);
    const wishes = [];
    for (const value of values) {
      try {
        if (value) wishes.push(JSON.parse(value));
      } catch {
        log('wishtree: skipping unreadable wish');
      }
    }
    return { wishes, total: Number(total) };
  }

  async function add(wish, ip) {
    const key = KEYS.rate(who(ip));
    const [count, , ttl] = await redis.pipeline([['INCR', key], ['EXPIRE', key, RATE_WINDOW, 'NX'], ['TTL', key]]);
    if (Number(count) > RATE_LIMIT) return { limited: true, retryAfter: Math.max(1, Number(ttl) > 0 ? Number(ttl) : RATE_WINDOW) };
    const ms = now();
    const saved = { id: makeId(ms), text: wish.text, name: wish.name, createdAt: new Date(ms).toISOString() };
    await redis.transaction([
      ['HSET', KEYS.data, saved.id, JSON.stringify(saved)],
      ['ZADD', KEYS.index, ms, saved.id],
    ]);
    return { saved };
  }

  async function remove(id) {
    const [removed] = await redis.transaction([['ZREM', KEYS.index, id], ['HDEL', KEYS.data, id]]);
    return Number(removed) > 0;
  }

  function isAdmin(authorization) {
    if (!adminToken) return false;
    const given = /^Bearer\s+(.+)$/i.exec(authorization || '')?.[1]?.trim() || '';
    const a = createHash('sha256').update(given).digest();
    const b = createHash('sha256').update(adminToken).digest();
    return given.length > 0 && timingSafeEqual(a, b);
  }

  async function guarded(fn) {
    if (!redis) return failure(503, 'unavailable', UNAVAILABLE, { 'Retry-After': '30' });
    try {
      return await fn();
    } catch (err) {
      log('wishtree: storage error', err?.message || err);
      return failure(503, 'unavailable', UNAVAILABLE, { 'Retry-After': '30' });
    }
  }

  /** GET and POST /api/wishes */
  async function handleWishes(req) {
    if (req.method === 'GET' || req.method === 'HEAD') {
      return guarded(async () => json(200, await list(), {
        // Every visitor sees the same list, so the CDN can share it for 10s.
        'Cache-Control': 'public, max-age=0, s-maxage=10, stale-while-revalidate=20',
      }));
    }
    if (req.method !== 'POST') return failure(405, 'method', 'That is not something this jar can do.', { Allow: 'GET, POST' });

    if (req.tooLarge) return failure(413, 'tooLong', MESSAGES.tooLong);
    let body = req.body;
    if (typeof body === 'string' || Buffer.isBuffer(body)) {
      try {
        body = JSON.parse(String(body));
      } catch {
        return failure(400, 'invalid', MESSAGES.invalid, {}, { field: 'text' });
      }
    }
    const check = validateWish(body);
    if (!check.ok) return failure(400, check.code, check.message, {}, { field: check.field });

    return guarded(async () => {
      const result = await add(check.wish, req.ip);
      if (result.limited) {
        const minutes = Math.ceil(result.retryAfter / 60);
        const when = minutes <= 1 ? 'in a minute' : minutes >= 55 ? 'in about an hour' : `in ${minutes} minutes`;
        return failure(429, 'rateLimited',
          `You have planted ${RATE_LIMIT} wishes this hour. Let them settle, and come back ${when}.`,
          { 'Retry-After': String(result.retryAfter) }, { retryAfter: result.retryAfter });
      }
      return json(201, { wish: result.saved });
    });
  }

  /** DELETE /api/wishes/:id (moderation) */
  async function handleWish(req, id) {
    if (req.method !== 'DELETE') return failure(405, 'method', 'That is not something this jar can do.', { Allow: 'DELETE' });
    if (!isAdmin(req.headers?.authorization)) {
      return failure(401, 'unauthorized', 'Only the gardener can remove wishes.', { 'WWW-Authenticate': 'Bearer' });
    }
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(id)) return failure(404, 'notFound', 'No wish with that id.');
    return guarded(async () => (await remove(id)
      ? json(200, { deleted: id })
      : failure(404, 'notFound', 'No wish with that id.')));
  }

  return { handleWishes, handleWish, list };
}
