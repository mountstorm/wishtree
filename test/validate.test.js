import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWish, isLinkOnly, cleanText, MAX_TEXT, MAX_NAME } from '../lib/validate.js';
import { isProfane } from '../lib/profanity.js';

const ok = (body) => {
  const r = validateWish(body);
  assert.equal(r.ok, true, `expected ok for ${JSON.stringify(body)}, got ${r.code}`);
  return r.wish;
};
const fails = (body, code, field = 'text') => {
  const r = validateWish(body);
  assert.equal(r.ok, false, `expected ${code} for ${JSON.stringify(body)}`);
  assert.equal(r.code, code);
  assert.equal(r.field, field);
  assert.ok(r.message.length > 10, 'has a human message');
};

test('trims and collapses whitespace', () => {
  assert.deepEqual(ok({ text: '  Peace \n\n and   quiet\t', name: '  Rose  ' }), { text: 'Peace and quiet', name: 'Rose' });
});

test('name is optional', () => {
  assert.deepEqual(ok({ text: 'Home' }), { text: 'Home', name: '' });
  assert.deepEqual(ok({ text: 'Home', name: null }), { text: 'Home', name: '' });
  assert.deepEqual(ok({ text: 'Home', name: '   ' }), { text: 'Home', name: '' });
});

test('strips invisible and direction-changing characters', () => {
  assert.equal(cleanText('Pea\u200bce\u202e for\u0000all'), 'Pea ce for all');
  assert.equal(ok({ text: '\u202eHope\u202c' }).text, 'Hope');
});

test('rejects empty wishes', () => {
  fails({ text: '' }, 'empty');
  fails({ text: '   \n\t ' }, 'empty');
  fails({ text: '\u200b\u200b' }, 'empty');
});

test(`allows exactly ${MAX_TEXT} characters and rejects more`, () => {
  ok({ text: 'a'.repeat(MAX_TEXT) });
  fails({ text: 'a'.repeat(MAX_TEXT + 1) }, 'tooLong');
  // Characters, not UTF-16 units: 80 emoji are 80 characters.
  ok({ text: '🍂'.repeat(MAX_TEXT) });
  fails({ text: 'x'.repeat(10_000) }, 'tooLong');
});

test(`allows names up to ${MAX_NAME} characters`, () => {
  ok({ text: 'Hope', name: 'n'.repeat(MAX_NAME) });
  fails({ text: 'Hope', name: 'n'.repeat(MAX_NAME + 1) }, 'nameTooLong', 'name');
});

test('rejects wrong shapes', () => {
  for (const body of [null, undefined, 'Peace', 42, [], { text: 42 }, { text: ['Peace'] }, { text: 'Peace', name: 7 }, {}]) {
    fails(body, 'invalid');
  }
});

test('rejects link-only text but keeps wishes that mention a site', () => {
  for (const text of ['https://example.com', 'http://x.co/abc?d=1', 'www.example.com', 'example.com', 'bit.ly/abc123', 'example.com example.org', '👉 https://spam.example/now 👈', 'shop.example.co.uk/deal!']) {
    assert.equal(isLinkOnly(text), true, text);
    fails({ text }, 'linkOnly');
  }
  for (const text of ['Thank you, wikipedia.org, for everything', 'Peace', 'Mr. Smith and Dr. Jones', 'Happy Thanksgiving!']) {
    assert.equal(isLinkOnly(text), false, text);
    ok({ text });
  }
  fails({ text: 'Hope', name: 'spam.example' }, 'linkOnly', 'name');
});

test('rejects text with no letters or numbers', () => {
  fails({ text: '!!! ... ???' }, 'noWords');
  ok({ text: '2027!' });
  ok({ text: 'Paz y amor' });
  ok({ text: 'Мир и любовь' });
  ok({ text: '平和' });
});

test('blocks profanity, including disguised spellings, in text and name', () => {
  for (const text of ['what the fuck', 'F U C K this', 'f.u.c.k', 'sh1t happens', 'fuuuuck', 'you are a b!tch', 'FUCKING turkey', 'go die', 'kill yourself']) {
    assert.equal(isProfane(text), true, text);
    fails({ text }, 'unkind');
  }
  fails({ text: 'Hope', name: 'Shithead' }, 'unkind', 'name');
});

test('does not block innocent words that contain rude ones', () => {
  for (const text of ['Greetings from Scunthorpe', 'Thank you to my class', 'My assistant is wonderful', 'Hello Dick and Jane', 'Cocktails at Nana’s', 'Shiitake stuffing', 'Essex sunsets', 'Spicy pumpkin pie', 'A peaceful passage', 'Die Wünsche', 'Hancock Park']) {
    assert.equal(isProfane(text), false, text);
    ok({ text });
  }
});

test('emoji count as words', () => {
  ok({ text: '🦃❤️' });
});
