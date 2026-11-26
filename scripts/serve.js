// Local development server: static files plus the same /api handlers that
// run on Vercel. Without Upstash env vars the API uses an in-memory store.
//   npm run dev              empty tree (in memory)
//   npm run dev -- --seed    start with 60 sample wishes
// With UPSTASH_REDIS_REST_URL/_TOKEN set it talks to the real database.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { createWishService, KEYS } from '../lib/wishes.js';
import { memoryRedis } from '../lib/redis.js';
import { serviceFromEnv, fromNode, send } from '../lib/http.js';

const root = resolve(new URL('..', import.meta.url).pathname);
const port = Number(process.env.PORT) || 5173;
export const DEV_ADMIN_TOKEN = 'dev-admin-token';
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** An API service backed by memory, optionally seeded with wishes. */
export async function memoryService(seedWishes = []) {
  const redis = memoryRedis();
  const commands = [];
  for (const w of seedWishes) {
    commands.push(['HSET', KEYS.data, w.id, JSON.stringify(w)], ['ZADD', KEYS.index, Date.parse(w.createdAt), w.id]);
  }
  if (commands.length) await redis.pipeline(commands);
  return createWishService({ redis, adminToken: DEV_ADMIN_TOKEN, salt: 'dev', log: console.warn });
}

async function serveStatic(req, res) {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(root) || /[\\/]\./.test(file.slice(root.length))) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}

/** Starts the server. `api` is a wish service (default: memory, unseeded). */
export async function startServer(p = port, { api } = {}) {
  const service = api || (await memoryService());
  const server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://x');
    const match = /^\/api\/wishes(?:\/([^/]+))?\/?$/.exec(pathname);
    if (!match) return serveStatic(req, res);
    try {
      const request = await fromNode(req);
      const result = match[1]
        ? await service.handleWish(request, decodeURIComponent(match[1]))
        : await service.handleWishes(request);
      send(res, result, req.method);
    } catch (err) {
      console.error(err);
      res.writeHead(500).end();
    }
  });
  return new Promise((ok) => server.listen(p, () => ok(server)));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const live = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN;
  let api;
  if (live) {
    api = serviceFromEnv();
  } else {
    const seed = process.argv.includes('--seed') ? (await import('../test/fixtures/sampleWishes.js')).sampleWishes : [];
    api = await memoryService(seed);
  }
  await startServer(port, { api });
  console.log(`Wish Tree on http://localhost:${port}`);
  console.log(live
    ? 'API: Upstash (from env)'
    : `API: in memory${process.argv.includes('--seed') ? ', seeded with 60 sample wishes' : ', empty'}; admin token "${DEV_ADMIN_TOKEN}"`);
}
