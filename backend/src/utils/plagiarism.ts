/**
 * Winnowing code similarity detection.
 * Reference: Schleimer, Wilkerson, Aiken (SIGCOMM 2003).
 *
 * Pipeline:
 *   1. Normalize code (strip comments, whitespace, identifiers -> placeholder)
 *   2. Generate K-grams and rolling hash
 *   3. Slide a window of W hashes, keep the minimum hash per window (fingerprint)
 *   4. Jaccard similarity between two fingerprint sets
 */

const K = 15; // K-gram length
const W = 30; // window size
const BASE = 257n;
const MOD = 1_000_000_007n;

// --- 1. Normalization -----------------------------------------------------

const LANGUAGE_NORMALIZERS: Record<string, (src: string) => string> = {
  cpp: stripCpp,
  c: stripCpp,
  'c++': stripCpp,
  java: stripJava,
  python: stripPython,
  py: stripPython,
  javascript: stripJs,
  js: stripJs,
  typescript: stripJs,
  ts: stripJs,
  go: stripGo,
};

function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    if (src[i] === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (src[i] === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
    } else if (src[i] === '#') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (src[i] === '"' || src[i] === "'" || src[i] === '`') {
      const quote = src[i];
      out += '_';
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\' && i + 1 < src.length) i += 2;
        else i++;
      }
      i++;
      out += '_';
    } else {
      out += src[i];
      i++;
    }
  }
  return out;
}

function stripCpp(src: string): string {
  return stripComments(src);
}
function stripJava(src: string): string {
  return stripComments(src);
}
function stripPython(src: string): string {
  return stripComments(src);
}
function stripJs(src: string): string {
  return stripComments(src);
}
function stripGo(src: string): string {
  return stripComments(src);
}

// Replace identifiers (letters/dollar/underscore followed by alnum) with single letter placeholder 'I'
function normalizeIdentifiers(src: string): string {
  return src.replace(/[a-zA-Z_$][a-zA-Z0-9_$]*/g, 'I');
}

// Collapse all whitespace into single spaces
function collapseWhitespace(src: string): string {
  return src.replace(/\s+/g, ' ').trim();
}

export function normalizeCode(src: string, language: string): string {
  const lang = (language || '').toLowerCase();
  const normalizer = LANGUAGE_NORMALIZERS[lang] || stripComments;
  const stripped = normalizer(src);
  const withPlaceholders = normalizeIdentifiers(stripped);
  return collapseWhitespace(withPlaceholders);
}

// --- 2. K-grams + rolling hash --------------------------------------------

function hashString(s: string): bigint {
  let h = 0n;
  for (let i = 0; i < s.length; i++) {
    h = (h * BASE + BigInt(s.charCodeAt(i))) % MOD;
  }
  return h;
}

function kgrams(s: string): bigint[] {
  if (s.length < K) return [hashString(s)];
  const grams: bigint[] = [];
  for (let i = 0; i <= s.length - K; i++) {
    grams.push(hashString(s.slice(i, i + K)));
  }
  return grams;
}

// --- 3. Winnowing ---------------------------------------------------------

function winnow(grams: bigint[]): Set<bigint> {
  if (grams.length === 0) return new Set();
  if (grams.length <= W) {
    // pick global minimum
    let min = grams[0];
    for (const g of grams) if (g < min) min = g;
    return new Set([min]);
  }
  const fingerprints = new Set<bigint>();
  let lastAdded: bigint | null = null;
  for (let i = 0; i <= grams.length - W; i++) {
    let min = grams[i];
    for (let j = i + 1; j < i + W; j++) {
      if (grams[j] < min) min = grams[j];
    }
    if (min !== lastAdded) {
      fingerprints.add(min);
      lastAdded = min;
    }
  }
  return fingerprints;
}

export function fingerprint(src: string, language: string): Set<bigint> {
  const normalized = normalizeCode(src, language);
  const grams = kgrams(normalized);
  return winnow(grams);
}

// --- 4. Jaccard similarity -------------------------------------------------

export function similarity(fpA: Set<bigint>, fpB: Set<bigint>): number {
  if (fpA.size === 0 || fpB.size === 0) return 0;
  let inter = 0;
  // Iterate over the smaller set for performance
  const [smaller, larger] = fpA.size <= fpB.size ? [fpA, fpB] : [fpB, fpA];
  for (const h of smaller) {
    if (larger.has(h)) inter++;
  }
  const union = fpA.size + fpB.size - inter;
  return union === 0 ? 0 : inter / union;
}

// --- Convenience: directly compute similarity between two source strings

export function compareCode(srcA: string, srcB: string, language: string): number {
  const fpA = fingerprint(srcA, language);
  const fpB = fingerprint(srcB, language);
  return similarity(fpA, fpB);
}

// Convert Set<bigint> to a JSON-serializable array of strings (for storage)
export function fingerprintToArray(fp: Set<bigint>): string[] {
  return Array.from(fp).map((b) => b.toString());
}
