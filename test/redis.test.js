import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upstashRedis, memoryRedis, RedisError } from '../lib/redis.js';

test('upstash client sends pipelines and transactions in the REST format', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => [{ result: 1 }, { result: ['a', 'b'] }] };
  };
  const redis = upstashRedis({ url: 'https://example.upstash.io/', token: 'tok', fetch });
  assert.deepEqual(await redis.pipeline([['INCR', 'k'], ['ZRANGE', 'z', 0, -1]]), [1, ['a', 'b']]);
  await redis.transaction([['ZADD', 'z', 5, 'm']]);
  assert.equal(calls[0].url, 'https://example.upstash.io/pipeline');
  assert.equal(calls[1].url, 'https://example.upstash.io/multi-exec');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  // Every argument is sent as a string.
  assert.deepEqual(JSON.parse(calls[0].init.body), [['INCR', 'k'], ['ZRANGE', 'z', '0', '-1']]);
});

test('upstash client surfaces errors', async () => {
  const reply = (status, body) => async () => ({ ok: status < 400, status, json: async () => body });
  await assert.rejects(upstashRedis({ url: 'u', token: 't', fetch: reply(200, [{ error: 'WRONGTYPE' }]) }).pipeline([['INCR', 'x']]), RedisError);
  await assert.rejects(upstashRedis({ url: 'u', token: 't', fetch: reply(401, { error: 'Unauthorized' }) }).pipeline([['INCR', 'x']]), /401/);
  const notJson = async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('bad'); } });
  await assert.rejects(upstashRedis({ url: 'u', token: 't', fetch: notJson }).pipeline([['INCR', 'x']]), /502/);
  assert.throws(() => upstashRedis({ url: '', token: 't' }), RedisError);
});

test('memory redis: sorted sets and hashes', async () => {
  const r = memoryRedis();
  await r.pipeline([['ZADD', 'z', 3, 'c'], ['ZADD', 'z', 1, 'a'], ['ZADD', 'z', 2, 'b']]);
  assert.deepEqual(
    await r.pipeline([['ZRANGE', 'z', 0, -1], ['ZRANGE', 'z', -2, -1], ['ZRANGE', 'z', -400, -1], ['ZCARD', 'z']]),
    [['a', 'b', 'c'], ['b', 'c'], ['a', 'b', 'c'], 3],
  );
  assert.deepEqual(await r.pipeline([['ZRANGE', 'none', 0, -1], ['ZCARD', 'none']]), [[], 0]);
  await r.pipeline([['HSET', 'h', 'a', '1', 'b', '2']]);
  assert.deepEqual(await r.pipeline([['HMGET', 'h', 'a', 'x', 'b'], ['HGET', 'h', 'b']]), [['1', null, '2'], '2']);
  assert.deepEqual(await r.transaction([['ZREM', 'z', 'b'], ['HDEL', 'h', 'b'], ['ZREM', 'z', 'b']]), [1, 1, 0]);
  assert.deepEqual(await r.pipeline([['ZRANGE', 'z', 0, -1]]), [['a', 'c']]);
});

test('memory redis: counters expire', async () => {
  let t = 0;
  const r = memoryRedis({ now: () => t });
  assert.deepEqual(
    await r.pipeline([['INCR', 'n'], ['EXPIRE', 'n', 60, 'NX'], ['INCR', 'n'], ['EXPIRE', 'n', 60, 'NX'], ['TTL', 'n']]),
    [1, 1, 2, 0, 60],
  );
  t = 59_000;
  assert.deepEqual(await r.pipeline([['INCR', 'n'], ['TTL', 'n']]), [3, 1]);
  t = 60_000;
  assert.deepEqual(await r.pipeline([['TTL', 'n'], ['INCR', 'n'], ['TTL', 'n']]), [-2, 1, -1]);
});
