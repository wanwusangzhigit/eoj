/**
 * SVG CAPTCHA generator and D1-based verification.
 *
 * Generates a simple SVG image with distorted text + noise.
 * Stores the answer in D1 by UUID for server-side verification.
 * Supports configurable strength levels via settings.
 */

// ── Generate a random code ──

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1 to avoid confusion

function randomCode(length: number): string {
  let code = '';
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < length; i++) {
    code += CHARS[randomValues[i] % CHARS.length];
  }
  return code;
}

// ── Crypto-secure random helpers ──

function secureRandom(): number {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0] / 0xFFFFFFFF;
}

function secureRandInt(min: number, max: number): number {
  const range = max - min;
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return min + (arr[0] % range);
}

function secureRandFloat(min: number, max: number): number {
  return min + secureRandom() * (max - min);
}

// ── SVG rendering ──

interface CaptchaSvgOptions {
  width?: number;
  height?: number;
  fontSize?: number;
  noiseLines?: number;
  noiseDots?: number;
  rotationRange?: number;
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${h},${s}%,${l}%)`;
}

function rand(min: number, max: number): number {
  return secureRandFloat(min, max);
}

// ── 5×7 bitmap font (no <text> elements, only <path>) ──
// Each character is a 5-wide × 7-tall grid of dots.
// 1 = filled dot, 0 = empty
const BITMAP_FONT: Record<string, number[]> = {
  'A': [0,1,0,1,0, 1,0,1,0,1, 1,1,1,1,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1],
  'B': [1,1,1,1,0, 1,0,0,0,1, 1,0,0,0,1, 1,1,1,1,0, 1,0,0,0,1, 1,0,0,0,1, 1,1,1,1,0],
  'C': [0,1,1,1,0, 1,0,0,0,1, 1,0,0,0,0, 1,0,0,0,0, 1,0,0,0,0, 1,0,0,0,1, 0,1,1,1,0],
  'D': [1,1,1,1,0, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,1,1,1,0],
  'E': [1,1,1,1,1, 1,0,0,0,0, 1,0,0,0,0, 1,1,1,1,0, 1,0,0,0,0, 1,0,0,0,0, 1,1,1,1,1],
  'F': [1,1,1,1,1, 1,0,0,0,0, 1,0,0,0,0, 1,1,1,1,0, 1,0,0,0,0, 1,0,0,0,0, 1,0,0,0,0],
  'G': [0,1,1,1,1, 1,0,0,0,0, 1,0,0,0,0, 1,0,0,1,1, 1,0,0,0,1, 1,0,0,0,1, 0,1,1,1,0],
  'H': [1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,1,1,1,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1],
  'J': [0,0,0,0,1, 0,0,0,0,1, 0,0,0,0,1, 0,0,0,0,1, 0,0,0,0,1, 1,0,0,0,1, 0,1,1,1,0],
  'K': [1,0,0,0,1, 1,0,0,1,0, 1,0,1,0,0, 1,1,0,0,0, 1,0,1,0,0, 1,0,0,1,0, 1,0,0,0,1],
  'L': [1,0,0,0,0, 1,0,0,0,0, 1,0,0,0,0, 1,0,0,0,0, 1,0,0,0,0, 1,0,0,0,0, 1,1,1,1,1],
  'M': [1,0,0,0,1, 1,1,0,1,1, 1,0,1,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1],
  'N': [1,0,0,0,1, 1,1,0,0,1, 1,0,1,0,1, 1,0,0,1,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1],
  'P': [1,1,1,1,0, 1,0,0,0,1, 1,0,0,0,1, 1,1,1,1,0, 1,0,0,0,0, 1,0,0,0,0, 1,0,0,0,0],
  'Q': [0,1,1,1,0, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,1,0,1, 0,1,1,1,0, 0,0,0,1,0],
  'R': [1,1,1,1,0, 1,0,0,0,1, 1,0,0,0,1, 1,1,1,1,0, 1,0,1,0,0, 1,0,0,1,0, 1,0,0,0,1],
  'S': [0,1,1,1,1, 1,0,0,0,0, 1,0,0,0,0, 0,1,1,1,0, 0,0,0,0,1, 0,0,0,0,1, 1,1,1,1,0],
  'T': [1,1,1,1,1, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0],
  'U': [1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 0,1,1,1,0],
  'V': [1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 0,1,0,1,0, 0,0,1,0,0],
  'W': [1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,1,0,1, 1,1,0,1,1, 1,0,0,0,1],
  'X': [1,0,0,0,1, 1,0,0,0,1, 0,1,0,1,0, 0,0,1,0,0, 0,1,0,1,0, 1,0,0,0,1, 1,0,0,0,1],
  'Y': [1,0,0,0,1, 1,0,0,0,1, 0,1,0,1,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0],
  'Z': [1,1,1,1,1, 0,0,0,0,1, 0,0,0,1,0, 0,0,1,0,0, 0,1,0,0,0, 1,0,0,0,0, 1,1,1,1,1],
  '2': [0,1,1,1,0, 1,0,0,0,1, 0,0,0,0,1, 0,0,0,1,0, 0,0,1,0,0, 0,1,0,0,0, 1,1,1,1,1],
  '3': [1,1,1,1,1, 0,0,0,0,1, 0,0,0,1,0, 0,0,1,1,0, 0,0,0,0,1, 0,0,0,0,1, 1,1,1,1,0],
  '4': [0,0,0,1,0, 0,0,1,1,0, 0,1,0,1,0, 1,0,0,1,0, 1,1,1,1,1, 0,0,0,1,0, 0,0,0,1,0],
  '5': [1,1,1,1,1, 1,0,0,0,0, 1,1,1,1,0, 0,0,0,0,1, 0,0,0,0,1, 1,0,0,0,1, 0,1,1,1,0],
  '6': [0,1,1,1,1, 1,0,0,0,0, 1,0,0,0,0, 1,1,1,1,0, 1,0,0,0,1, 1,0,0,0,1, 0,1,1,1,0],
  '7': [1,1,1,1,1, 0,0,0,0,1, 0,0,0,1,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0],
  '8': [0,1,1,1,0, 1,0,0,0,1, 1,0,0,0,1, 0,1,1,1,0, 1,0,0,0,1, 1,0,0,0,1, 0,1,1,1,0],
  '9': [0,1,1,1,0, 1,0,0,0,1, 1,0,0,0,1, 0,1,1,1,1, 0,0,0,0,1, 0,0,0,0,1, 1,1,1,1,0],
};

/** Render a single character as SVG path data using bitmap font */
function charToPath(ch: string, px: number, py: number, cellW: number, cellH: number, dotR: number): string {
  const bitmap = BITMAP_FONT[ch];
  if (!bitmap) return '';
  const paths: string[] = [];
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 5; col++) {
      if (bitmap[row * 5 + col]) {
        const cx = px + col * cellW + cellW / 2;
        const cy = py + row * cellH + cellH / 2;
        paths.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${dotR.toFixed(1)}"/>`);
      }
    }
  }
  return paths.join('');
}

function renderSvg(code: string, opts: CaptchaSvgOptions = {}): string {
  const W = opts.width || 200;
  const H = opts.height || 70;
  const noiseLines = opts.noiseLines ?? 8;
  const noiseDots = opts.noiseDots ?? 30;
  const rotationRange = opts.rotationRange ?? 25;

  const lines: string[] = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);

  // Background
  const bgHue = Math.floor(rand(0, 360));
  lines.push(`<rect width="${W}" height="${H}" fill="${hsl(bgHue, 8, 95)}" rx="6"/>`);

  // Noise lines
  const lCount = Math.floor(rand(noiseLines, noiseLines + 4));
  for (let i = 0; i < lCount; i++) {
    const x1 = rand(0, W);
    const y1 = rand(0, H);
    const x2 = rand(0, W);
    const y2 = rand(0, H);
    const stroke = hsl(Math.floor(rand(0, 360)), Math.floor(rand(40, 80)), Math.floor(rand(40, 70)));
    lines.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${rand(1, 2.5)}" opacity="0.5"/>`);
  }

  // Noise dots
  const dCount = Math.floor(rand(noiseDots, noiseDots + 20));
  for (let i = 0; i < dCount; i++) {
    const cx = rand(0, W);
    const cy = rand(0, H);
    const r = rand(1, 3);
    const fill = hsl(Math.floor(rand(0, 360)), Math.floor(rand(40, 80)), Math.floor(rand(30, 60)));
    lines.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" opacity="0.6"/>`);
  }

  // Characters rendered as bitmap font paths (no <text> elements)
  const charWidth = W / code.length;
  const cellW = charWidth / 6;
  const cellH = 5;
  const dotR = cellW * 0.55;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    const baseX = charWidth * i + charWidth * 0.15 + rand(2, 6);
    const baseY = H / 2 - 12 + rand(-4, 4);
    const rot = rand(-rotationRange, rotationRange);
    const hue = Math.floor(rand(0, 360));
    const sat = Math.floor(rand(50, 80));
    const lit = Math.floor(rand(30, 50));
    const fill = hsl(hue, sat, lit);
    const pathData = charToPath(ch, baseX, baseY, cellW, cellH, dotR);
    if (pathData) {
      lines.push(
        `<g fill="${fill}" opacity="0.9" transform="rotate(${rot.toFixed(1)},${(baseX + charWidth / 2).toFixed(1)},${(baseY + 14).toFixed(1)})">${pathData}</g>`
      );
    }
  }

  lines.push('</svg>');
  return lines.join('\n');
}

// ── Math problem captcha ──

interface MathProblem {
  display: string;  // e.g. "12 + 34 = ?"
  answer: string;   // e.g. "46"
}

function generateMathProblem(cfg: { length: number }): MathProblem {
  const ops = ['+', '-'];
  const op = ops[secureRandInt(0, ops.length)];
  let a: number, b: number;

  if (op === '+') {
    a = secureRandInt(10, 60);
    b = secureRandInt(10, 60);
  } else {
    a = secureRandInt(20, 100);
    b = secureRandInt(1, a);
  }

  const answer = op === '+' ? a + b : a - b;
  return { display: `${a} ${op} ${b} = ?`, answer: String(answer) };
}

// ── Strength configs ──

const STRENGTH_CONFIGS: Record<string, { length: number; noiseLines: number; noiseDots: number; rotationRange: number }> = {
  easy:   { length: 4, noiseLines: 3,  noiseDots: 10, rotationRange: 15 },
  medium: { length: 5, noiseLines: 8,  noiseDots: 30, rotationRange: 25 },
  hard:   { length: 6, noiseLines: 14, noiseDots: 50, rotationRange: 35 },
};

// ── D1 operations ──

export interface CaptchaRecord {
  uuid: string;
  svg: string;
  type: 'text' | 'math';
  answer_length: number;
}

/**
 * Read a captcha setting from the D1 settings table.
 */
async function getSetting(db: D1Database, key: string, fallback: string): Promise<string> {
  try {
    const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first() as any;
    return row?.value ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Generate a new CAPTCHA, store in D1, return { uuid, svg, type, answer_length }.
 * Strength and type are read from settings.
 */
export async function createCaptcha(db: D1Database): Promise<CaptchaRecord> {
  // Clean expired codes first
  await db.prepare("DELETE FROM captcha_codes WHERE expires_at < datetime('now')").run();

  const strength = await getSetting(db, 'captcha_strength', 'medium');
  const cfg = STRENGTH_CONFIGS[strength] || STRENGTH_CONFIGS.medium;
  const captchaType = await getSetting(db, 'captcha_type', 'text');

  let code: string;
  let svg: string;
  let type: 'text' | 'math';
  let answer_length: number;
  const uuid = crypto.randomUUID();

  if (captchaType === 'math') {
    const problem = generateMathProblem(cfg);
    code = problem.answer;
    svg = renderSvg(problem.display, {
      noiseLines: cfg.noiseLines,
      noiseDots: cfg.noiseDots,
      rotationRange: cfg.rotationRange,
    });
    type = 'math';
    answer_length = code.length;
  } else {
    code = randomCode(cfg.length);
    svg = renderSvg(code, {
      noiseLines: cfg.noiseLines,
      noiseDots: cfg.noiseDots,
      rotationRange: cfg.rotationRange,
    });
    type = 'text';
    answer_length = cfg.length;
  }

  await db.prepare(
    'INSERT INTO captcha_codes (uuid, answer, expires_at) VALUES (?, ?, datetime(\'now\', \'+5 minutes\'))'
  ).bind(uuid, code).run();

  return { uuid, svg, type, answer_length };
}

/**
 * Check whether a specific feature requires captcha.
 * Reads from settings table, defaults to true.
 */
export async function isCaptchaRequired(db: D1Database, feature: string): Promise<boolean> {
  const masterEnabled = await getSetting(db, 'captcha_enabled', 'true');
  if (masterEnabled !== 'true') return false;

  const featureSetting = await getSetting(db, `captcha_${feature}`, 'false');
  return featureSetting === 'true';
}

/**
 * Verify a CAPTCHA answer. Returns true if valid, false otherwise.
 * Marks the code as used (one-time) regardless of success/failure.
 * Limits to 3 attempts per UUID, then forces expiry.
 */
export async function verifyCaptcha(db: D1Database, uuid: string, answer: string): Promise<boolean> {
  if (!uuid || !answer) return false;

  const row = await db.prepare(
    "SELECT id, answer, used, attempts, expires_at FROM captcha_codes WHERE uuid = ?"
  ).bind(uuid).first() as any;

  if (!row) return false;

  // Check TTL
  const now = new Date().toISOString();
  if (row.expires_at <= now) return false;

  // Already used
  if (row.used === 1) return false;

  // Increment attempts counter
  await db.prepare('UPDATE captcha_codes SET attempts = COALESCE(attempts, 0) + 1 WHERE id = ?').bind(row.id).run();

  // Max 3 attempts per UUID
  if ((row.attempts || 0) >= 3) {
    await db.prepare('UPDATE captcha_codes SET used = 1 WHERE id = ?').bind(row.id).run();
    return false;
  }

  // Mark as used (one-time)
  await db.prepare('UPDATE captcha_codes SET used = 1 WHERE id = ?').bind(row.id).run();

  // Compare (case-insensitive)
  return String(row.answer).toUpperCase() === String(answer).toUpperCase();
}