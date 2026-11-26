// Talks to /api/wishes. Every failure becomes an ApiError whose message is
// written for people, ready to show in the form.

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'network', field = 'text', retryAfter = 0 } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
    this.retryAfter = retryAfter;
  }
}

const RESTING = 'The jar is resting right now. Please try again in a moment.';
const OFFLINE = 'We could not reach the jar. Check your connection and try again.';

async function request(method, body) {
  let res;
  try {
    res = await fetch('/api/wishes', {
      method,
      headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(OFFLINE);
  }
  let data = null;
  try {
    data = await res.json();
  } catch { /* not JSON: handled below */ }
  if (!res.ok || !data) {
    const e = data?.error || {};
    throw new ApiError(e.message || RESTING, { status: res.status, code: e.code || 'unavailable', field: e.field, retryAfter: e.retryAfter });
  }
  return data;
}

/** @returns {Promise<{wishes: Array, total: number}>} */
export async function fetchWishes() {
  const data = await request('GET');
  return { wishes: Array.isArray(data.wishes) ? data.wishes : [], total: Number(data.total) || 0 };
}

/** @returns {Promise<{id, text, name, createdAt}>} the wish as saved */
export async function sendWish(text, name) {
  return (await request('POST', { text, name })).wish;
}
