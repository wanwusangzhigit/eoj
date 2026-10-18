/**
 * 主题属性应用 helper（审计美化 #1）
 *
 * 背景：'notebook' 主题在视觉上完全独立（温暖纸张色 + 宋体），
 * 但在组件层面（按钮、表单、卡片）希望复用 default 主题的全部既有 CSS 规则。
 *
 * 解决方案：当 site theme = 'notebook' 时，在 <html> 上同时写入两个属性：
 *   - data-theme-style="default"     → 让 [data-theme-style="default"] 选择器命中
 *   - data-theme-flavor="notebook"   → 让 [data-theme-flavor="notebook"] 选择器做差异化覆盖
 *
 * 其他主题（default / classic / flat / aurora）只写 data-theme-style，
 * 并清掉 data-theme-flavor 防止上次切换残留。
 *
 * 这个模块集中维护「site theme → DOM 属性」的映射逻辑，避免在 main.tsx / Layout.tsx /
 * entry-server.tsx 三处分散实现不同步。
 */

export type SiteTheme = 'default' | 'classic' | 'flat' | 'aurora' | 'notebook';

/**
 * 'notebook' 主题在 DOM 属性层面伪装成 default，以便复用 default 的全部组件 CSS。
 * 返回值为真正应该写到 data-theme-style 上的字符串。
 */
export function resolveThemeStyleAttr(siteTheme: string | undefined): string {
  return siteTheme === 'notebook' ? 'default' : (siteTheme || 'default');
}

/**
 * 'notebook' 主题额外的 flavor 属性值；其他主题返回空串（调用方应移除该属性）。
 */
export function resolveThemeFlavorAttr(siteTheme: string | undefined): string {
  return siteTheme === 'notebook' ? 'notebook' : '';
}

/**
 * 在客户端 <html> 上一次性应用主题属性。
 * 在 main.tsx 启动期与 Layout.tsx 的 config 变更 effect 中调用。
 */
export function applyThemeAttributes(rootEl: HTMLElement, siteTheme: string | undefined): void {
  rootEl.setAttribute('data-theme-style', resolveThemeStyleAttr(siteTheme));
  const flavor = resolveThemeFlavorAttr(siteTheme);
  if (flavor) {
    rootEl.setAttribute('data-theme-flavor', flavor);
  } else {
    rootEl.removeAttribute('data-theme-flavor');
  }
}

/**
 * 在 SSR 阶段，把 <html> 模板字符串里的占位属性替换为正确的主题属性。
 *
 * index.html 写死了 `data-theme-style="default"`，本函数处理两种情况：
 *   - 普通 theme：把 "default" 替换为 theme 名（与历史行为一致）
 *   - notebook：保留 data-theme-style="default"，并在 <html> 标签上插入 data-theme-flavor="notebook"
 */
export function injectThemeAttributesIntoHtml(
  htmlTemplate: string,
  siteTheme: string | undefined,
): string {
  if (siteTheme === 'notebook') {
    // 保留默认的 data-theme-style="default"，并在 <html ...> 标签末尾追加 flavor 属性
    if (htmlTemplate.includes('<html ') && !htmlTemplate.includes('data-theme-flavor')) {
      return htmlTemplate.replace(
        /<html\b([^>]*)>/,
        (_fullMatch, attrs: string) => {
          // 已经有 data-theme-style="default" 就不重复写
          if (/data-theme-style\s*=/.test(attrs)) {
            return `<html${attrs} data-theme-flavor="notebook">`;
          }
          return `<html${attrs} data-theme-style="default" data-theme-flavor="notebook">`;
        },
      );
    }
    return htmlTemplate;
  }
  // 非 notebook：沿用历史 replace 路径（占位属性值是 "default"，替换为目标 theme）
  if (siteTheme && siteTheme !== 'default') {
    return htmlTemplate.replace('data-theme-style="default"', `data-theme-style="${siteTheme}"`);
  }
  return htmlTemplate;
}
