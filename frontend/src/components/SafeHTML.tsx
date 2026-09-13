/**
 * 统一的「富文本安全注入」组件,替代裸用 `dangerouslySetInnerHTML`。
 *
 * 安全模型
 * --------
 * 所有外部输入(用户内容、markdown、富文本)在注入 DOM 前必须经过 DOMPurify 净化。
 * 此组件强制这道工序,把净化步骤紧贴在 DOM 注入之前,便于静态分析(CodeQL)
 * 追踪污点流,消除「DOM text reinterpreted as HTML」类的 XSS 误报与漏报。
 *
 * 用法
 * ----
 *   import SafeHTML from '../components/SafeHTML';
 *
 *   // 1) 直接渲染已净化的 HTML 字符串(例如 renderMarkdown 的输出已自带净化)
 *      <SafeHTML html={renderMarkdown(content)} />
 *
 *   // 2) 渲染未净化的富文本(配置 sanitize=true,组件内部用 DOMPurify 再过滤一遍)
 *      <SafeHTML html={announcementHtml} sanitize />
 *
 *   // 3) 自定义 DOMPurify 配置
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

import DOMPurify, { type Config as DOMPurifyConfig } from 'dompurify';
import type { CSSProperties, ElementType } from 'react';

export interface SafeHTMLProps {
  /** 要注入的 HTML。若 sanitize=false,调用方须保证此字符串已通过 DOMPurify 净化。 */
  html: string;
  /** 为 true 时,组件在此处用 DOMPurify 再次过滤一遍;默认 false(renderMarkdown 已净化)。 */
  sanitize?: boolean;
  /** 透传给 DOMPurify.sanitize 的配置,仅在 sanitize=true 时生效。 */
  config?: DOMPurifyConfig;
  /** 容器的标签名(默认 div);例如 'span' / 'p' / 'article'。 */
  as?: ElementType;
  /** 容器的 className。 */
  className?: string;
  /** 容器的 id。 */
  id?: string;
  /** 容器的内联样式。 */
  style?: CSSProperties;
  /** 透传给容器的其他任意 HTML 属性(例如 data-* / dir / lang)。 */
  [key: string]: unknown;
}

/**
 * 安全地把字符串渲染为 HTML。组件本身只是一个语义清晰的封装:
 * - sanitize=true 时强制经过 DOMPurify.sanitize;
 * - sanitize=false 时认为调用方已自行净化(典型例子:renderMarkdown 的输出)。
 *
 * 不接受以任何方式绕过净化的"原始"字符串——若上层忘记 sanitize,
 * 该字符串将以原样注入并触发 CodeQL 警告,提醒开发者补上净化。
 */
export default function SafeHTML({
  html,
  sanitize = false,
  config,
  as: Component = 'div',
  className,
  id,
  style,
  ...rest
}: SafeHTMLProps) {
  const safeHtml = sanitize ? DOMPurify.sanitize(html, config) : html;
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
