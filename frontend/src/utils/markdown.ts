import { marked } from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';

// Configure marked
marked.setOptions({
  breaks: true,
  gfm: true,
});

const MATH_PLACEHOLDER = '@@EOJ_MATH_';

function renderMath(expression: string, displayMode: boolean): string {
  try {
    return katex.renderToString(expression, {
      throwOnError: false,
      displayMode,
      output: 'html',
      strict: 'ignore',
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

  const mathBlocks: string[] = [];
  const preprocessed = text
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, expression) => {
      const placeholder = `${MATH_PLACEHOLDER}${mathBlocks.length}@@`;
      mathBlocks.push(renderMath(expression.trim(), true));
      return placeholder;
    })
    .replace(/(^|[^\\])\$([^\$\n][^\$]*?)\$/g, (_, prefix, expression) => {
      const placeholder = `${MATH_PLACEHOLDER}${mathBlocks.length}@@`;
      mathBlocks.push(renderMath(expression.trim(), false));
      return `${prefix}${placeholder}`;
    });

  const html = marked.parse(preprocessed) as string;
  const sanitizedHtml = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'img', 'ul', 'ol', 'li',
      'blockquote', 'pre', 'code', 'em', 'strong', 'del', 'table', 'thead', 'tbody',
      'tr', 'th', 'td', 'br', 'hr', 'sup', 'sub', 'span', 'div',
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'target', 'rel', 'style'],
    ALLOW_DATA_ATTR: false,
  });

  const htmlWithMath = replaceMathPlaceholders(sanitizedHtml, mathBlocks);
  return htmlWithMath.replace(/<a /g, '<a target="_blank" rel="noopener noreferrer" ');
}
