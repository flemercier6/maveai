// Keyword extraction shared with the edge function (kept in sync).
// Used to tag user memories so the chat can match them against the current
// query without re-deriving them server-side every time.

const STOPWORDS = new Set<string>([
  // English
  "the","a","an","and","or","but","if","then","else","of","in","on","at","to","for","with","from","by",
  "is","are","was","were","be","been","being","am","do","does","did","done","doing","have","has","had",
  "having","i","you","he","she","it","we","they","me","him","her","us","them","my","your","his","its",
  "our","their","this","that","these","those","there","here","what","which","who","whom","whose","when",
  "where","why","how","not","no","yes","ok","okay","so","than","too","very","just","also","as",
  "can","could","should","would","may","might","must","will","shall","want","need","like","know","get",
  "got","let","make","made","go","goes","went","come","came","take","took","see","saw","look","one","two",
  // French
  "le","la","les","un","une","des","de","du","et","ou","mais","si","alors","sinon","dans","sur","au","aux",
  "pour","avec","sans","par","est","sont","etait","etaient","etre","fait","faire","ai","as","avons",
  "avez","ont","avoir","je","tu","il","elle","on","nous","vous","ils","elles","me","te","se","mon","ton",
  "son","ma","ta","sa","mes","tes","ses","notre","votre","leur","nos","vos","leurs","ce","cet","cette",
  "ces","ca","celui","celle","ceux","celles","qui","que","quoi","dont","ou","quand","comment","pourquoi",
  "pas","ne","non","oui","plus","moins","tres","trop","aussi","encore","deja","peu","beaucoup","tout",
  "tous","toute","toutes","peut","peux","pouvoir","veux","veut","vouloir","dois","doit","devoir",
  "vais","va","aller","sais","sait","savoir","comme","car","donc","puis","cela","ceci",
]);

/** Extract a normalized set of topical keywords from arbitrary text. */
export function extractKeywords(text: string, max = 12): string[] {
  if (!text) return [];
  const norm = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const tokens = norm.match(/[a-z0-9]{3,}/g) ?? [];
  const counts = new Map<string, number>();
  for (const t of tokens) {
    if (STOPWORDS.has(t)) continue;
    if (/^\d+$/.test(t)) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([t]) => t);
}
