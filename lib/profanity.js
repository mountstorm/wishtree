// A basic profanity filter: whole words only (so "Scunthorpe", "class" and
// "assistant" are fine), after undoing common disguises: l33t digits,
// accents and stretched letters ("fuuuck"). It is a first line of defence;
// the admin delete endpoint handles anything it misses.

const WORDS = [
  'fuck', 'fucker', 'fuckers', 'fucking', 'fucked', 'fucks', 'motherfucker', 'motherfuckers', 'fuckoff', 'fuckyou',
  'shit', 'shits', 'shitty', 'shithead', 'bullshit', 'horseshit',
  'bitch', 'bitches', 'bitchy', 'bastard', 'bastards',
  'asshole', 'assholes', 'arsehole', 'dickhead', 'dickheads',
  'cunt', 'cunts', 'twat', 'twats', 'wanker', 'wankers', 'whore', 'whores', 'slut', 'sluts',
  'douchebag', 'jackass', 'pissoff',
  'retard', 'retards', 'retarded',
  'fag', 'fags', 'faggot', 'faggots', 'nigger', 'niggers', 'nigga', 'niggas',
  'chink', 'chinks', 'spic', 'spics', 'kike', 'kikes', 'tranny', 'trannies', 'wetback', 'wetbacks',
  'rapist', 'kys',
];
// Phrases checked across word boundaries.
const PHRASES = [['kill', 'yourself'], ['go', 'die']];

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i' };

const collapse = (w) => w.replace(/(.)\1+/g, '$1');
const BAD = new Set(WORDS);
const BAD_COLLAPSED = new Set(WORDS.map(collapse));

function words(text) {
  const plain = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[0-9@$!|]/g, (c) => LEET[c] ?? c);
  return plain.split(/[^a-z]+/).filter(Boolean);
}

/** True if the text contains a blocked word or phrase. */
export function isProfane(text) {
  const list = words(String(text ?? ''));
  for (const w of list) {
    if (BAD.has(w) || BAD_COLLAPSED.has(collapse(w))) return true;
  }
  // "f u c k" and "f.u.c.k": runs of single letters joined up.
  let run = '';
  for (const w of [...list, '']) {
    if (w.length === 1) run += w;
    else {
      if (run.length >= 3 && (BAD.has(run) || BAD_COLLAPSED.has(collapse(run)))) return true;
      run = '';
    }
  }
  for (const phrase of PHRASES) {
    for (let i = 0; i + phrase.length <= list.length; i++) {
      if (phrase.every((p, j) => list[i + j] === p)) return true;
    }
  }
  return false;
}
