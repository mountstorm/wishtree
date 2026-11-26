import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createWishService, LIMIT, RATE_LIMIT, RATE_WINDOW, KEYS } from '../lib/wishes.js';
import { memoryRedis } from '../lib/redis.js';
import { fromNode, send, clientIp } from '../lib/http.js';

const ADMIN = 'correct horse battery staple';

function setup({ adminToken = ADMIN, redis } = {}) {
  let t = Date.UTC(2026, 10, 26, 12, 0, 0);
  let seq = 0;
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const store = redis === undefined ? memoryRedis({ now: clock.now }) : redis;
  const logs = [];
  const api = createWishService({
    redis: store, adminToken, salt: 'test', now: clock.now,
    newId: (ms) => `${ms.toString(36)}-${String(++seq).padStart(4, '0')}`,
    log: (...a) => logs.push(a.join(' ')),
  });
  const get = () => api.handleWishes({ method: 'GET', headers: {} });
  const post = (body, ip = '203.0.113.7') => api.handleWishes({ method: 'POST', headers: {}, body, ip });
  const del = (id, token = ADMIN) => api.handleWish({ method: 'DELETE', headers: token ? { authorization: `Bearer ${token}` } : {} }, id);
  return { api, store, clock, get, post, del, logs };
}

test('GET on an empty tree', async () => {
  const { get } = setup();
  const res = await get();
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { wishes: [], total: 0 });
});

test('GET is cached for 10 seconds at the CDN', async () => {
  const { get } = setup();
  const cc = (await get()).headers['Cache-Control'];
  assert.match(cc, /s-maxage=10\b/);
  assert.match(cc, /\bpublic\b/);
});

test('POST saves a clean wish and returns it', async () => {
  const { post, get } = setup();
  const res = await post({ text: '  Health   for Grandma  ', name: ' Rose ' });
  assert.equal(res.status, 201);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  const { wish } = res.body;
  assert.deepEqual(Object.keys(wish).sort(), ['createdAt', 'id', 'name', 'text']);
  assert.equal(wish.text, 'Health for Grandma');
  assert.equal(wish.name, 'Rose');
  assert.equal(wish.createdAt, '2026-11-26T12:00:00.000Z');
  assert.deepEqual((await get()).body, { wishes: [wish], total: 1 });
});

test('POST accepts a JSON string body (as a raw request gives it)', async () => {
  const { post } = setup();
  assert.equal((await post(JSON.stringify({ text: 'Peace' }))).status, 201);
  assert.equal((await post(Buffer.from(JSON.stringify({ text: 'Joy' })))).status, 201);
  const bad = await post('{not json');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'invalid');
});

test('user text is stored exactly, never turned into markup', async () => {
  const { post, get } = setup();
  const text = '<img src=x onerror=alert(1)> & "quotes"';
  await post({ text, name: '<b>Bo</b>' });
  const [wish] = (await get()).body.wishes;
  assert.equal(wish.text, text);
  assert.equal(wish.name, '<b>Bo</b>');
});

test('POST rejects bad wishes with a clear 400 the UI can show', async () => {
  const { post, get } = setup();
  const cases = [
    [{ text: '   ' }, 'empty', 'text'],
    [{ text: 'x'.repeat(81) }, 'tooLong', 'text'],
    [{ text: 'Hope', name: 'n'.repeat(25) }, 'nameTooLong', 'name'],
    [{ text: 'https://spam.example/win' }, 'linkOnly', 'text'],
    [{ text: 'what the f*ck, sh1t' }, 'unkind', 'text'],
    [{ text: 42 }, 'invalid', 'text'],
    [null, 'invalid', 'text'],
  ];
  for (const [body, code, field] of cases) {
    const res = await post(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.error.code, code, JSON.stringify(body));
    assert.equal(res.body.error.field, field);
    assert.ok(res.body.error.message.length > 10);
  }
  assert.equal((await get()).body.total, 0, 'nothing was saved');
});

test(`allows ${RATE_LIMIT} wishes per IP per hour, then a kind 429`, async () => {
  const { post, clock } = setup();
  for (let i = 0; i < RATE_LIMIT; i++) assert.equal((await post({ text: `Wish ${i}` })).status, 201);
  clock.advance(15 * 60_000);
  const limited = await post({ text: 'One more' });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'rateLimited');
  assert.equal(limited.headers['Retry-After'], String(45 * 60));
  assert.equal(limited.body.error.retryAfter, 45 * 60);
  assert.match(limited.body.error.message, /come back in 45 minutes/);

  // Other visitors are unaffected.
  assert.equal((await post({ text: 'Mine' }, '198.51.100.1')).status, 201);
  // After the hour, the first visitor can wish again.
  clock.advance(45 * 60_000);
  assert.equal((await post({ text: 'Back again' })).status, 201);
});

test('invalid wishes do not use up the rate limit', async () => {
  const { post } = setup();
  for (let i = 0; i < 5; i++) assert.equal((await post({ text: '' })).status, 400);
  assert.equal((await post({ text: 'Real wish' })).status, 201);
});

test('the rate limit is counted in redis by a hashed IP, never the IP itself', async () => {
  const seen = [];
  const inner = memoryRedis();
  const spy = {
    pipeline: (cmds) => { seen.push(...cmds); return inner.pipeline(cmds); },
    transaction: (cmds) => { seen.push(...cmds); return inner.transaction(cmds); },
  };
  const { post } = setup({ redis: spy });
  await post({ text: 'Hope' }, '203.0.113.99');
  const rateKeys = seen.filter((c) => c[0] === 'INCR').map((c) => c[1]);
  assert.equal(rateKeys.length, 1);
  assert.ok(rateKeys[0].startsWith('wishtree:rate:'));
  assert.ok(!JSON.stringify(seen).includes('203.0.113.99'), 'the raw IP never reaches storage');
  assert.ok(seen.some((c) => c[0] === 'EXPIRE' && Number(c[2]) === RATE_WINDOW), 'the counter expires after the window');
});

test(`GET returns the latest ${LIMIT} wishes, oldest first, and the full count`, async () => {
  const { store, get } = setup();
  const commands = [];
  for (let i = 0; i < LIMIT + 25; i++) {
    const wish = { id: `w${i}`, text: `Wish ${i}`, name: '', createdAt: new Date(1_700_000_000_000 + i * 1000).toISOString() };
    commands.push(['HSET', KEYS.data, wish.id, JSON.stringify(wish)], ['ZADD', KEYS.index, 1_700_000_000_000 + i * 1000, wish.id]);
  }
  await store.pipeline(commands);
  const { wishes, total } = (await get()).body;
  assert.equal(total, LIMIT + 25);
  assert.equal(wishes.length, LIMIT);
  assert.equal(wishes[0].id, 'w25');
  assert.equal(wishes.at(-1).id, `w${LIMIT + 24}`);
});

test('GET skips an unreadable record instead of failing', async () => {
  const { store, get, post, logs } = setup();
  await post({ text: 'Good' });
  await store.pipeline([['HSET', KEYS.data, 'broken', '{oops'], ['ZADD', KEYS.index, 1, 'broken']]);
  const res = await get();
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.wishes.map((w) => w.text), ['Good']);
  assert.equal(logs.length, 1);
});

test('without storage the API says the tree is resting (503), for GET and POST', async () => {
  const { get, post } = setup({ redis: null });
  for (const res of [await get(), await post({ text: 'Hope' })]) {
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'unavailable');
    assert.match(res.body.error.message, /resting/);
  }
});

test('storage errors become a 503, not a crash', async () => {
  const broken = { pipeline: async () => { throw new Error('ECONNRESET'); }, transaction: async () => { throw new Error('ECONNRESET'); } };
  const { get, post, logs } = setup({ redis: broken });
  assert.equal((await get()).status, 503);
  assert.equal((await post({ text: 'Hope' })).status, 503);
  assert.equal(logs.length, 2);
});

test('other methods are refused', async () => {
  const { api } = setup();
  const res = await api.handleWishes({ method: 'PUT', headers: {} });
  assert.equal(res.status, 405);
  assert.equal(res.headers.Allow, 'GET, POST');
  assert.equal((await api.handleWish({ method: 'GET', headers: {} }, 'x')).status, 405);
});

test('admin can delete a wish with the token', async () => {
  const { post, del, get } = setup();
  const keep = (await post({ text: 'Keep me' })).body.wish;
  const drop = (await post({ text: 'Remove me' })).body.wish;
  const res = await del(drop.id);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { deleted: drop.id });
  assert.deepEqual((await get()).body, { wishes: [keep], total: 1 });
  assert.equal((await del(drop.id)).status, 404, 'already gone');
});

test('delete needs the right token, and is off when no token is configured', async () => {
  const { post, del, get } = setup();
  const { id } = (await post({ text: 'Stay' })).body.wish;
  for (const token of [null, '', 'wrong', `${ADMIN} `.repeat(2)]) {
    const res = await del(id, token);
    assert.equal(res.status, 401, String(token));
    assert.equal(res.headers['WWW-Authenticate'], 'Bearer');
  }
  assert.equal((await get()).body.total, 1);

  const open = setup({ adminToken: '' });
  const other = (await open.post({ text: 'Stay' })).body.wish;
  assert.equal((await open.del(other.id, '')).status, 401);
  assert.equal((await open.del(other.id, 'anything')).status, 401);
});

test('delete rejects malformed ids', async () => {
  const { del } = setup();
  for (const id of ['', '../etc', 'a'.repeat(100), 'x y']) assert.equal((await del(id)).status, 404);
});

// ---------------------------------------------------------------- http glue

function fakeReq({ method = 'POST', headers = {}, body, chunks = [] } = {}) {
  const req = Readable.from(chunks.map((c) => Buffer.from(c)));
  return Object.assign(req, { method, headers, body, socket: { remoteAddress: '10.0.0.9' } });
}

test('reads the client IP from the proxy header first', () => {
  assert.equal(clientIp(fakeReq({ headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' } })), '203.0.113.5');
  assert.equal(clientIp(fakeReq({ headers: { 'x-real-ip': '198.51.100.2' } })), '198.51.100.2');
  assert.equal(clientIp(fakeReq()), '10.0.0.9');
});

test('reads raw bodies, uses pre-parsed ones, and refuses huge ones', async () => {
  assert.equal((await fromNode(fakeReq({ chunks: ['{"text":', '"Hi"}'] }))).body, '{"text":"Hi"}');
  assert.deepEqual((await fromNode(fakeReq({ body: { text: 'Hi' } }))).body, { text: 'Hi' });
  const huge = await fromNode(fakeReq({ chunks: ['x'.repeat(5000), 'y'.repeat(5000)] }));
  assert.equal(huge.tooLarge, true);
  const { api } = setup();
  assert.equal((await api.handleWishes({ ...huge, headers: {} })).status, 413);
});

test('send writes status, headers and JSON', () => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  send(res, { status: 201, headers: { 'X-A': '1' }, body: { ok: true } });
  assert.equal(res.statusCode, 201);
  assert.equal(res.headers['X-A'], '1');
  assert.equal(res.body, '{"ok":true}');
});
