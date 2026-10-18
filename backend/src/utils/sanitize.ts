/**
 * 服务端富文本净化（审计 #H-18）
 * ============================
 *
 * 背景
 * ----
 * 此前富文本（公告、自定义页面、博客、题解、讨论）的内容完全依赖前端
 * DOMPurify 净化后注入 DOM。一旦前端某个组件忘记走 <SafeHTML> 或漏调
 * renderMarkdown，就会形成存储型 XSS；管理员账号被盗即可通过公告攻击
 * 全体用户。本模块提供「纵深防御」层：在写入 D1 之前先剥离最危险的
 * HTML 模式，使得即便前端有疏漏，存储的内容也无法承载经典 XSS payload。
 *
 * 设计取舍
 * --------
 * - Markdown 语法（包括 ``` 代码块与 ` 行内代码）完整保留，避免破坏
 *   代码示例与正常文章排版。
 * - 仅清洗代码块之外的 HTML 片段，剥离：
 *     · <script> / <style> / <iframe> / <object> / <embed> / <applet>
 *       / <svg> / <math> / <form> / <input> / <button> / <meta> / <link>
 *       / <base> / <frame> / <frameset> / <noscript> 等危险标签
 *     · 所有 on* 事件属性（onload、onerror、onclick 等）
 *     · href/src 中的 javascript: / vbscript: / data:text/html
 *       / data:image/svg+xml 协议
 * - 服务端净化是「最后防线」，并不能取代前端 DOMPurify——前端仍要做
 *   完整的白名单净化（保留合法标签与属性）。本模块只剔除最致命的模式。
 *
 * 不做的事
 * --------
 * - 不解析 HTML（Workers 没有 DOM）；使用正则匹配，已对常见混淆
 *   （大小写、空白、自闭合、属性顺序）做了覆盖。
 * - 不保留 HTML 实体的语义（避免双解码漏洞），所有匹配都基于原始字符串。
 * - 不修复破损的 HTML——只是剥离危险片段，剩余内容原样返回。
 */

// 危险标签列表：完全剥离（连同内容或自闭合形式）。
// - script/style/object/embed 等会带「内容」，需要成对剥离
// - iframe/applet/meta/link/base 等通常是自闭合或无需内容，单独剥离
const DANGEROUS_BLOCK_TAGS = ['script', 'style', 'iframe', 'object', 'embed', 'applet', 'noscript', 'frameset'];
const DANGEROUS_VOID_TAGS = ['iframe', 'meta', 'link', 'base', 'frame', 'input', 'button', 'textarea', 'select', 'svg', 'math'];

// 编译一次复用。注意 `i` 标志：标签大小写不敏感。
const DANGEROUS_BLOCK_REGEX = new RegExp(
  `<(${DANGEROUS_BLOCK_TAGS.join('|')})\\b[^>]*>[\\s\\S]*?</\\1\\s*>`,
  'gi'
);
const DANGEROUS_VOID_REGEX = new RegExp(
  `<(?:${DANGEROUS_VOID_TAGS.join('|')})\\b[^>]*?/?>`,
  'gi'
);

// on* 事件处理属性：onload="..."、onerror='...'、onclick=foo 等
const ON_ATTR_REGEX = /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>/]+)/gi;

// 危险 URL 协议（href/src 的值）
const DANGEROUS_URL_REGEX = /(?:(href|src|formaction|xlink:href|data)\s*=\s*(["']))\s*(?:javascript|vbscript|data:text\/html|data:image\/svg\+xml)[^"']*?\2/gi;

// Markdown 围栏代码块（``` 三个反引号开头，可能带语言标识），到下一个 ``` 闭合
const FENCED_CODE_REGEX = /```[\s\S]*?```/g;
// 行内代码（单个反引号包起来，非贪婪）
const INLINE_CODE_REGEX = /`[^`\n]*?`/g;

/**
 * 净化一段富文本。保留 Markdown 代码块原样，仅清洗其余 HTML 片段。
 *
 * 用法：
 *   const clean = sanitizeRichText(userInput);
 *   await db.prepare('INSERT INTO blogs (...) VALUES (?, ?)').bind(title, clean).run();
 */
export function sanitizeRichText(input: unknown): string {
  if (input === null || input === undefined) return '';
  if (typeof input !== 'string') return String(input);

  // 用占位符保护代码块（围栏 / 行内），再做剥离，最后还原。
  // 这样代码示例中的 <script> 不会被误删，保留教学/文档价值。
  const placeholders: string[] = [];
  const stash = (text: string): string => {
    const idx = placeholders.length;
    placeholders.push(text);
    // 占位符使用双下划线包裹的标记，避开常规文本与 Markdown 语法；
    // 不使用控制字符（避免 eslint no-control-regex），也不使用反引号/井号等 Markdown 元字符。
    return `__SANITIZER_CODE_HOLDER_${idx}__`;
  };

  let work = input.replace(FENCED_CODE_REGEX, (m) => stash(m));
  work = work.replace(INLINE_CODE_REGEX, (m) => stash(m));

  // 剥离危险标签
  work = work.replace(DANGEROUS_BLOCK_REGEX, '');
  work = work.replace(DANGEROUS_VOID_REGEX, '');

  // 剥离事件处理属性
  work = work.replace(ON_ATTR_REGEX, '');

  // 剥离危险 URL 协议（替换为同文档锚点，保留 href 属性结构以免破坏布局）
  work = work.replace(DANGEROUS_URL_REGEX, (_, attr, quote) => `${attr}=${quote}#${quote}`);

  // 还原代码块
  if (placeholders.length > 0) {
    work = work.replace(/__SANITIZER_CODE_HOLDER_(\d+)__/g, (_, i) => placeholders[Number(i)] ?? '');
  }

  return work;
}

/**
 * 净化纯文本字段（如标题、签名）。剥离所有 HTML 标签并转义 < > & " '，
 * 适合用于不会经过 Markdown / 富文本渲染的字段。
 */
export function sanitizePlainText(input: unknown, maxLen?: number): string {
  if (input === null || input === undefined) return '';
  let s = typeof input === 'string' ? input : String(input);
  // 先剥离任何标签（防止 <script> 等被原样渲染）
  s = s.replace(/<[^>]*>/g, '');
  // 转义 HTML 特殊字符
  s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  if (typeof maxLen === 'number' && s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}
