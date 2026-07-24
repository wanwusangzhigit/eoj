/**
 * SVG CAPTCHA generator and D1-based verification.
 *
 * Generates a simple SVG image with distorted text + noise,
 * then renders it to PNG via @resvg/resvg-wasm.
 * Stores the answer in D1 by UUID for server-side verification.
 * Supports configurable strength levels via settings.
 */

// ── resvg-wasm: lazy singleton for SVG→PNG ──

// Direct import of the .wasm binary — wrangler/esbuild bundles it as WebAssembly.Module
import resvgWasmModule from '@resvg/resvg-wasm/index_bg.wasm';
import { getInterFontBuffer } from '../fonts/inter';

let resvgInitPromise: Promise<void> | null = null;

/**
 * Initialize the resvg WASM module exactly once.
 * Safe to call multiple times — subsequent calls return the existing promise.
 */
function ensureResvg(): Promise<void> {
  if (!resvgInitPromise) {
    resvgInitPromise = (async () => {
      const { initWasm } = await import('@resvg/resvg-wasm');
      await initWasm(resvgWasmModule);
    })();
  }
  return resvgInitPromise;
}

/**
 * Render an SVG string to PNG bytes using resvg-wasm.
 * @param svg - The SVG string to render.
 * @returns PNG as Uint8Array.
 */
export async function svgToPng(svg: string): Promise<Uint8Array> {
  await ensureResvg();
  const { Resvg } = await import('@resvg/resvg-wasm');
  const resvg = new Resvg(svg, {
    background: '#ffffff',
    fitTo: { mode: 'original' },
    font: {
      fontBuffers: [getInterFontBuffer()],
      defaultFontFamily: 'Inter',
      sansSerifFamily: 'Inter',
    },
  });
  const rendered = resvg.render();
  return rendered.asPng();
}

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

  // Noise dots / decorative circles
  const dCount = Math.floor(rand(noiseDots, noiseDots + 20));
  for (let i = 0; i < dCount; i++) {
    const cx = rand(0, W);
    const cy = rand(0, H);
    const r = rand(1, 3);
    const fill = hsl(Math.floor(rand(0, 360)), Math.floor(rand(40, 80)), Math.floor(rand(30, 60)));
    lines.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" opacity="0.6"/>`);
  }

  // Characters rendered as <text> elements (resvg renders them to PNG server-side)
  const charWidth = W / code.length;
  const fontSize = charWidth * 0.7;

  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    const x = charWidth * i + charWidth / 2;
    const y = H / 2 + fontSize * 0.35;
    const rot = rand(-rotationRange, rotationRange);
    const hue = Math.floor(rand(0, 360));
    const sat = Math.floor(rand(50, 80));
    const lit = Math.floor(rand(30, 50));
    const fill = hsl(hue, sat, lit);

    lines.push(
      `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" ` +
      `font-family="Inter, sans-serif" ` +
      `font-size="${fontSize.toFixed(1)}" ` +
      `font-weight="bold" ` +
      `fill="${fill}" ` +
      `text-anchor="middle" ` +
      `transform="rotate(${rot.toFixed(1)},${x.toFixed(1)},${y.toFixed(1)})" ` +
      `opacity="0.9">${escXml(ch)}</text>`
    );
  }

  lines.push('</svg>');
  return lines.join('\n');
}

/** Escape <, >, & in XML text content to prevent injection */
function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
  pngBase64: string;
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
 * Generate a new CAPTCHA, store in D1, return { uuid, pngBase64, type, answer_length }.
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

  // Render SVG to PNG bytes, then encode as base64
  const pngBytes = await svgToPng(svg);
  const pngBase64 = arrayBufferToBase64(pngBytes);

  await db.prepare(
    'INSERT INTO captcha_codes (uuid, answer, expires_at) VALUES (?, ?, datetime(\'now\', \'+5 minutes\'))'
  ).bind(uuid, code).run();

  return { uuid, pngBase64, type, answer_length };
}

function arrayBufferToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
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
    "SELECT id, answer, used, attempts FROM captcha_codes WHERE uuid = ? AND expires_at > datetime('now')"
  ).bind(uuid).first() as any;

  if (!row) return false;

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