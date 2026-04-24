// Client-side detection of "writing" requests that should open a canvas.
// Matches common French + English keywords for drafting content.

const WRITING_KEYWORDS: RegExp[] = [
  // French
  /\b(r[ée]dige|r[ée]dig[ée]r|[ée]cri[st]?|[ée]crire|r[ée]dact(?:ion|er))\b/i,
  /\b(mail|e-?mail|courriel)\b/i,
  /\bnote\b/i,
  /\b(rapport|compte[- ]rendu)\b/i,
  /\barticle\b/i,
  /\bblog\b/i,
  /\bannonce\b/i,
  /\b(communiqu[ée]\s+de\s+presse|press\s+release)\b/i,
  /\bdescription\b/i,
  /\bm[ée]mo\b/i,
  /\blettre\b/i,
  /\bpost(?:\s+linkedin)?\b/i,
  /\bdiscours\b/i,
  // English
  /\b(write|draft|compose)\b/i,
  /\b(email|letter|memo|report|article|blog|post|announcement|press\s+release|description|speech)\b/i,
];

/** Heuristic: does this user message look like a drafting/writing task? */
export function looksLikeWritingRequest(text: string): boolean {
  if (!text || text.trim().length < 8) return false;
  return WRITING_KEYWORDS.some((re) => re.test(text));
}
