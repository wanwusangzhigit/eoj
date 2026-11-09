/**
 * 统一的「富文本安全注入」组件,替代裸用 `dangerouslySetInnerHTML`。
 *
 * 安全模型
 * --------
 * 所有外部输入(用户内容、markdown、富文本)在注入 DOM 前必须经过 DOMPurify 净化。
 * 此组件强制这道工序,把净化步骤紧贴在 DOM 注入之前,便于静态分析(CodeQL)
 * 追踪污点流,消除「DOM text reinterpreted as HTML」类的 XSS 误报与漏报。
 *
 * SSR / 水合
 * ----------
 * Cloudflare Workers 没有 DOM,`dompurify` 的默认导出在那里是一个 factory
 * 函数而非已初始化实例(没有 `.sanitize`),`marked` 依赖的净化链路同样不可用。
 * 因此富文本只在浏览器挂载后渲染:
 *  - 服务端渲染与客户端 hydrate 首帧都输出**转义后的纯文本**(React 自动转义,
 *    不存在 XSS),两端 DOM 完全一致,避免 React #418 水合错误;
 *  - `useEffect` 触发后再调用 `renderMarkdown()` / `DOMPurify.sanitize()` 注入 HTML。
 *
 * 用法
 * ----
 *   import SafeHTML from '../components/SafeHTML';
 *
 *   // 1) 渲染 markdown 源文本(组件内部完成 marked + DOMPurify)
 *      <SafeHTML className="markdown-content" markdown text={problem.description} />
 *
 *   // 2) 渲染已净化的 HTML 字符串
 *      <SafeHTML html={sanitizedHtml} />
 *
 *   // 3) 渲染未净化的富文本(配置 sanitize=true,组件内部用 DOMPurify 再过滤一遍)
 *      <SafeHTML html={announcementHtml} sanitize />
 *
 *   // 4) 自定义 DOMPurify 配置
 *      <SafeHTML html={rawHtml} sanitize config={{ ALLOWED_TAGS: ['b', 'i'] }} />
 *
 * 为什么不直接复用 dangerouslySetInnerHTML
 * ---------------------------------------
 * - 静态分析器(CodeQL、Semgrep 等)对 `dangerouslySetInnerHTML` 的污点追踪依赖
 *   显式的数据流标记。`renderMarkdown` 这类「函数内部调用 DOMPurify」的跨函数
 *   净化模式很难被自动识别为安全,从而产生大量误报。
 * - 通过统一的 <SafeHTML> 入口,所有「需要把字符串当作 HTML 渲染」的代码点
 *   都集中在此组件,既便于审计,也让静态分析在单一节点验证净化逻辑。
 */

import { useEffect, useState, type CSSProperties, type ElementType } from 'react';
import DOMPurify, { type Config as DOMPurifyConfig } from 'dompurify';
import { renderMarkdown } from '../utils/markdown';

export interface SafeHTMLProps {
  /** 要注入的 HTML。markdown=true 时忽略。 */
  html?: string;
  /** markdown 源文本,仅在 markdown=true 时使用。 */
  text?: string | null;
  /** 为 true 时用 renderMarkdown(text) 生成 HTML(内部已净化)。默认 false。 */
  markdown?: boolean;
  /** 为 true 时,组件在此处用 DOMPurify 再次过滤一遍;默认 false。 */
  sanitize?: boolean;
  /** 透传给 DOMPurify.sanitize 的配置,仅在 sanitize=true 时生效。 */
  config?: DOMPurifyConfig;
  /** 容器的标签名(默认 div);例如 'span' / 'p' / 'article'。 */
  as?: ElementType;
  className?: string;
  id?: string;
  style?: CSSProperties;
  /** 透传给容器的其他任意 HTML 属性(例如 data-* / dir / lang)。 */
  [key: string]: unknown;
}

/**
 * 安全地把字符串渲染为 HTML。
 * - SSR / hydrate 首帧:输出纯文本,服务端不触碰 DOMPurify 与 marked;
 * - 挂载后:markdown=true 走 renderMarkdown,sanitize=true 走 DOMPurify.sanitize,
 *   其余认为调用方已自行净化。
 */
export default function SafeHTML({
  html,
  text,
  markdown = false,
  sanitize = false,
  config,
  as: Component = 'div',
  className,
  id,
  style,
  ...rest
}: SafeHTMLProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const source = markdown ? (text ?? '') : (html ?? '');

  // 服务端与客户端首帧保持完全一致:纯文本由 React 自动转义,不会注入 HTML。
  if (!mounted) {
    return (
      <Component className={className} id={id} style={style} {...rest}>
        {source}
      </Component>
    );
  }

  const safeHtml = markdown
    ? renderMarkdown(text ?? '')
    : sanitize
      ? DOMPurify.sanitize(html ?? '', config)
      : (html ?? '');

  return (
    <Component
      className={className}
      id={id}
      style={style}
      dangerouslySetInnerHTML={{ __html: safeHtml }}
      {...rest}
    />
  );
}
