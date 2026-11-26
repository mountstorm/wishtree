// Two interchangeable Redis clients with the same tiny interface:
//   pipeline(commands)    runs commands in order, returns their results
//   transaction(commands) the same, atomically (MULTI/EXEC)
// `upstashRedis` talks to Upstash over its REST API (no dependency);
// `memoryRedis` keeps everything in memory for tests and local development.

export class RedisError extends Error {}

export function upstashRedis({ url, token, fetch = globalThis.fetch }) {
  if (!url || !token) throw new RedisError('Upstash URL and token are required');
  const base = url.replace(/\/+$/, '');
  async function send(path, commands) {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands.map((c) => c.map(String))),
    });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new RedisError(`Upstash answered ${res.status} without JSON`);
    }
    if (!res.ok || !Array.isArray(data)) throw new RedisError(`Upstash error ${res.status}: ${data?.error ?? 'unexpected reply'}`);
    return data.map((r) => {
      if (r.error) throw new RedisError(r.error);
      return r.result;
    });
  }
  return {
    pipeline: (commands) => send('/pipeline', commands),
    transaction: (commands) => send('/multi-exec', commands),
  };
}

/** An in-memory Redis covering the commands the app uses. */
export function memoryRedis({ now = () => Date.now() } = {}) {
  const store = new Map(); // key -> { value, expiresAt }

  function get(key) {
    const entry = store.get(key);
    if (entry && entry.expiresAt != null && entry.expiresAt <= now()) {
      store.delete(key);
      return undefined;
    }
    return entry;
  }
  function typed(key, Kind) {
    let entry = get(key);
    if (!entry) store.set(key, (entry = { value: new Kind(), expiresAt: null }));
    if (!(entry.value instanceof Kind)) throw new RedisError('WRONGTYPE Operation against a key holding the wrong kind of value');
    return entry.value;
  }
  const sortedIds = (zset) => [...zset.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([m]) => m);

  const commands = {
    ZADD(key, score, member) {
      const z = typed(key, Map);
      const added = z.has(member) ? 0 : 1;
      z.set(member, Number(score));
      return added;
    },
    ZRANGE(key, start, stop) {
      const ids = get(key) ? sortedIds(typed(key, Map)) : [];
      const n = ids.length;
      let s = Number(start), e = Number(stop);
      s = s < 0 ? Math.max(0, n + s) : s;
      e = e < 0 ? n + e : Math.min(e, n - 1);
      return e < s ? [] : ids.slice(s, e + 1);
    },
    ZCARD: (key) => (get(key) ? typed(key, Map).size : 0),
    ZREM(key, ...members) {
      if (!get(key)) return 0;
      const z = typed(key, Map);
      return members.filter((m) => z.delete(m)).length;
    },
    HSET(key, ...pairs) {
      const h = typed(key, Map);
      let added = 0;
      for (let i = 0; i < pairs.length; i += 2) {
        if (!h.has(pairs[i])) added++;
        h.set(pairs[i], String(pairs[i + 1]));
      }
      return added;
    },
    HGET: (key, field) => (get(key) ? typed(key, Map).get(field) ?? null : null),
    HMGET: (key, ...fields) => fields.map((f) => (get(key) ? typed(key, Map).get(f) ?? null : null)),
    HDEL(key, ...fields) {
      if (!get(key)) return 0;
      const h = typed(key, Map);
      return fields.filter((f) => h.delete(f)).length;
    },
    INCR(key) {
      const entry = get(key);
      const next = (entry ? Number(entry.value) : 0) + 1;
      store.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null });
      return next;
    },
    EXPIRE(key, seconds, flag) {
      const entry = get(key);
      if (!entry) return 0;
      if (flag === 'NX' && entry.expiresAt != null) return 0;
      entry.expiresAt = now() + Number(seconds) * 1000;
      return 1;
    },
    TTL(key) {
      const entry = get(key);
      if (!entry) return -2;
      if (entry.expiresAt == null) return -1;
      return Math.ceil((entry.expiresAt - now()) / 1000);
    },
    DEL: (...keys) => keys.filter((k) => get(k) && store.delete(k)).length,
  };

  function run(list) {
    return list.map(([name, ...args]) => {
      const fn = commands[String(name).toUpperCase()];
      if (!fn) throw new RedisError(`memoryRedis does not support ${name}`);
      return fn(...args.map(String));
    });
  }
  return {
    pipeline: async (list) => run(list),
    transaction: async (list) => run(list),
  };
}
