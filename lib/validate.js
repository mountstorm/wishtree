// Turns a raw POST body into a clean wish, or a kind explanation of why not.

import { isProfane } from './profanity.js';

export const MAX_TEXT = 80;
export const MAX_NAME = 24;

// Control characters, zero-width characters and bidi overrides (which can make
// text display differently from what it says).
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;

export function cleanText(value) {
  return String(value).replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
}

const length = (s) => [...s].length;

// A link: a scheme or www. prefix, or something.tld with an optional path.
const LINK = /(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/\S*)?/gi;
// Letters, digits or emoji: a wish of just a turkey and a heart is a fine
// wish; "!!!" is not.
const HAS_WORDS = /[\p{L}\p{N}\p{Extended_Pictographic}]/u;

/** True when the text is nothing but links (and punctuation). */
export function isLinkOnly(text) {
  const links = text.match(LINK);
  if (!links) return false;
  // Emoji around a link ("look here -> link") do not make it a wish.
  return !/[\p{L}\p{N}]/u.test(text.replace(LINK, ' '));
}

export const MESSAGES = {
  invalid: 'Something about that wish did not come through. Please try again.',
  empty: 'Your wish is empty. Type a few words first.',
  noWords: 'Please write your wish in words.',
  tooLong: `That wish is a little long. Please keep it to ${MAX_TEXT} characters.`,
  nameTooLong: `Please keep your name to ${MAX_NAME} characters.`,
  linkOnly: 'Links cannot grow on the tree. Please write your wish in words.',
  unkind: 'Let’s keep the tree kind. Please try different words.',
};

/**
 * @returns {{ok: true, wish: {text: string, name: string}} |
 *           {ok: false, code: string, field: string, message: string}}
 */
export function validateWish(body) {
  const fail = (code, field) => ({ ok: false, code, field, message: MESSAGES[code] });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('invalid', 'text');
  const { text: rawText, name: rawName = '' } = body;
  if (typeof rawText !== 'string' || (rawName !== null && typeof rawName !== 'string')) return fail('invalid', 'text');
  // Refuse absurd payloads before doing any work on them.
  if (rawText.length > MAX_TEXT * 8 || (rawName ?? '').length > MAX_NAME * 8) return fail('tooLong', 'text');

  const text = cleanText(rawText);
  const name = cleanText(rawName ?? '');
  if (!text) return fail('empty', 'text');
  if (length(text) > MAX_TEXT) return fail('tooLong', 'text');
  if (length(name) > MAX_NAME) return fail('nameTooLong', 'name');
  if (isLinkOnly(text)) return fail('linkOnly', 'text');
  if (!HAS_WORDS.test(text)) return fail('noWords', 'text');
  if (isProfane(text)) return fail('unkind', 'text');
  if (name && isProfane(name)) return fail('unkind', 'name');
  if (name && isLinkOnly(name)) return fail('linkOnly', 'name');
  return { ok: true, wish: { text, name } };
}
