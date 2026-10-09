const TOKEN_PATTERN = /[\p{L}\p{N}]+(?:[._-][\p{L}\p{N}]+)*(?:\+\+|#)?/gu;
const SEPARATOR_PATTERN = /[._-]/;
const LETTER_PATTERN = /\p{L}/u;

export const STOP_WORDS = new Set(
  'a an and are as at be by for from has have how i in is it of on or that the this to was what when where which who why with you'.split(
    ' '
  )
);

export function tokenize(text) {
  const clean = String(text ?? '')
    .normalize('NFKC')
    .toLowerCase();
  const matches = clean.match(TOKEN_PATTERN) || [];
  const tokens = [];
  for (const token of matches) {
    tokens.push(token);
    if (!SEPARATOR_PATTERN.test(token)) continue;
    for (const part of token.split(/[._-]/)) {
      if (part && part !== token && LETTER_PATTERN.test(part)) tokens.push(part);
    }
  }
  return tokens;
}

export function tokenSet(text) {
  return new Set(tokenize(text));
}
