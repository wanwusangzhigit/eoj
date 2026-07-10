/**
 * Generate a device fingerprint based on browser characteristics.
 * This is a client-side fingerprint that helps identify devices for audit/ban purposes.
 * It's not foolproof but provides a reasonable identifier.
 */

async function generateCanvasFingerprint(): Promise<string> {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('OJ-FP', 2, 15);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillText('OJ-FP', 4, 17);
    const data = canvas.toDataURL();
    // Simple hash
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      hash = ((hash << 5) - hash) + data.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  } catch {
    return '';
  }
}

function getScreenFingerprint(): string {
  try {
    return `${screen.width}x${screen.height}x${screen.colorDepth}`;
  } catch {
    return '';
  }
}

function getTimezoneFingerprint(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return '';
  }
}

function getLanguageFingerprint(): string {
  return navigator.language || '';
}

function getPlatformFingerprint(): string {
  return navigator.platform || '';
}

function getHardwareFingerprint(): string {
  try {
    return `${navigator.hardwareConcurrency || 0}:${(navigator as any).deviceMemory || 0}`;
  } catch {
    return '0:0';
  }
}

export async function generateDeviceFingerprint(): Promise<string> {
  const components = [
    await generateCanvasFingerprint(),
    getScreenFingerprint(),
    getTimezoneFingerprint(),
    getLanguageFingerprint(),
    getPlatformFingerprint(),
    getHardwareFingerprint(),
  ];

  const raw = components.join('|');

  // Hash to fixed length
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash) + raw.charCodeAt(i);
    hash |= 0;
  }

  return 'fp_' + Math.abs(hash).toString(36).padStart(8, '0');
}

// Cache the fingerprint
let cachedFingerprint: string | null = null;

export async function getDeviceFingerprint(): Promise<string> {
  if (cachedFingerprint) return cachedFingerprint;
  cachedFingerprint = await generateDeviceFingerprint();
  return cachedFingerprint;
}
