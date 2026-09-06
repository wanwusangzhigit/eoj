import { useEffect, useState, type ReactNode } from 'react';

/**
 * 仅在客户端渲染的组件包装器。
 *
 * SSR 阶段会渲染 fallback(默认 null),hydration 完成后才切换到 children。
 * 用于以下场景:
 * - 重组件依赖浏览器 API(document/window/navigator),SSR 会崩溃或无意义
 * - 例:CodeMirror 编辑器、Canvas 指纹、第三方脚本注入
 *
 * 关键点:
 * - 服务端渲染 fallback,客户端 hydration 时状态一致(useEffect 只在客户端运行)
 * - useEffect 触发 setState(true) 让组件挂载后切换到 children,无 hydration mismatch
 *
 * @example
 * <ClientOnly fallback={<div className="editor-placeholder" />}>
 *   <CodeMirror value={code} onChange={setCode} />
 * </ClientOnly>
 */
export default function ClientOnly({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted ? <>{children}</> : <>{fallback}</>;
}
