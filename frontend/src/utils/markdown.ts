import { marked } from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';

// Configure marked
marked.setOptions({
  breaks: true,
  gfm: true,
});

const MATH_PLACEHOLDER = '@@EOJ_MATH_';

// KaTeX 输出本身已是受限白名单标签(span、class),但为统一防线,所有要插入到 DOM
// 的 HTML 都应通过 DOMPurify。这里先把数学表达式替换为不可注入的纯文本占位符,
// 让 marked 与 DOMPurify 完整处理整个 HTML,最后才把占位符替换为同样经过净化的
// KaTeX 输出。这样即使 KaTeX 上游出现意外,也会被纳入净化管线。
function renderMath(expression: string, displayMode: boolean): string {
  try {
    const raw = katex.renderToString(expression, {
      throwOnError: false,
      displayMode,
      output: 'html',
      strict: 'ignore',
    });
    // 把 KaTeX 输出纳入 DOMPurify,白名单收紧到 KaTeX 实际需要的标签/属性
    return DOMPurify.sanitize(raw, {
      ALLOWED_TAGS: ['span', 'math', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac', 'msqrt', 'mroot', 'mtable', 'mtr', 'mtd', 'mtext', 'mspace', 'annotation', 'semantics', 'mstyle', 'merror', 'mfenced', 'munderover', 'munder', 'mover'],
      ALLOWED_ATTR: ['class', 'style', 'aria-hidden', 'role', 'encoding', 'mathvariant'],
      ALLOW_DATA_ATTR: false,
    });
  } catch {
    return `<code>${DOMPurify.sanitize(expression)}</code>`;
  }
}

function replaceMathPlaceholders(html: string, mathBlocks: string[]): string {
  return mathBlocks.reduce((currentHtml, mathHtml, idx) => {
    return currentHtml.replace(`${MATH_PLACEHOLDER}${idx}@@`, mathHtml);
  }, html);
}

export function renderMarkdown(text: string): string {
  if (!text) return '';

  // 用纯文本占位符替换数学公式,保证占位符不会被 marked/DOMPurify 误处理或注入。
  // 占位符仅含 [A-Z_@],不可能承载 HTML 语义。
  // 同时记录每段公式是否为 display 模式,供后续渲染。
  const mathBlocks: { expression: string; display: boolean }[] = [];
  const preprocessed = text
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, expression) => {
      const placeholder = `${MATH_PLACEHOLDER}${mathBlocks.length}@@`;
      mathBlocks.push({ expression: expression.trim(), display: true });
      return placeholder;
    })
    .replace(/(^|[^\\])\$([^$\n][^$]*?)\$/g, (_, prefix, expression) => {
      const placeholder = `${MATH_PLACEHOLDER}${mathBlocks.length}@@`;
      mathBlocks.push({ expression: expression.trim(), display: false });
      return `${prefix}${placeholder}`;
    });

  // 修复"带空格的加粗标记":CommonMark 规范要求 **内容** 内不能有首尾空白,
  // 因此 ** 解释 ** 会被 marked 原样输出而非加粗。但 OJ 题目模板/人工输入
  // 常写成带空格形式,这里在交给 marked 之前把 `** 内容 **` 归一律化为 `**内容**`,
  // 使其正常渲染为加粗。此时数学公式已被替换为不含 `*` 的占位符,正则不会误伤公式。
  const normalized = preprocessed.replace(/\*{2}\s+([^*\n][^*\n]*?)\s+\*{2}/g, '**$1**');

  const html = marked.parse(normalized) as string;
  // 整体净化一次:此时占位符仍是纯文本,DOMPurify 不会破坏它们
  const sanitizedHtml = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'img', 'ul', 'ol', 'li',
      'blockquote', 'pre', 'code', 'em', 'strong', 'del', 'table', 'thead', 'tbody',
      'tr', 'th', 'td', 'br', 'hr', 'sup', 'sub', 'span', 'div',
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'target', 'rel'],
    ALLOW_DATA_ATTR: false,
  });

  // 最后一步:把占位符替换为同样经过 DOMPurify 净化的 KaTeX HTML。
  // 这样 KaTeX 上游若出现意外标签,也会被纳入净化管线。
  const renderedMathBlocks = mathBlocks.map((m) => renderMath(m.expression, m.display));
  const htmlWithMath = replaceMathPlaceholders(sanitizedHtml, renderedMathBlocks);
  // 仅匹配 <a> 起始标签(后跟空白字符或直接是 >),避免误匹配 <abbr>、<address> 等。
  return htmlWithMath.replace(/<a(?=[\s>])/g, '<a target="_blank" rel="noopener noreferrer" ');
}
