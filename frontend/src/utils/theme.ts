/**
 * 主题定制:把管理端配置的主题色(settings.theme_accent)动态应用到 CSS 变量。
 * 覆盖 global.css 中的 --accent / --accent-hover / --accent-light,
 * 使整站强调色随配置变化。
 */

function hexToRgba(hex: string, alpha: number): string {
  const m = (hex || '').replace('#', '');
  if (!m) return 'transparent';
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return 'transparent';
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function applyThemeAccent(accent?: string): void {
  const root = document.documentElement;
  const color = (accent || '').trim();
  if (!color) {
    // 清空自定义主题色,回退到 CSS 默认
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-hover');
    root.style.removeProperty('--accent-light');
    return;
  }
  root.style.setProperty('--accent', color);
  root.style.setProperty('--accent-hover', color);
  root.style.setProperty('--accent-light', hexToRgba(color, 0.1));
}

let customStyleEl: HTMLStyleElement | null = null;

/**
 * 应用用户自定义 CSS(存于 user_settings.custom_css)。
 * 通过注入 <style> 元素实现,可覆盖任意主题变量/组件样式。
 */
export function applyCustomCss(css?: string): void {
  const content = (css || '').trim();
  if (!content) {
    if (customStyleEl) {
      customStyleEl.remove();
      customStyleEl = null;
    }
    return;
  }
  if (!customStyleEl) {
    customStyleEl = document.createElement('style');
    customStyleEl.setAttribute('data-custom-css', 'true');
    document.head.appendChild(customStyleEl);
  }
  customStyleEl.textContent = content;
}
