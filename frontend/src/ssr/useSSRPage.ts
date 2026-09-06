import { useRef, useEffect } from 'react';
import { consumeSSRPageData } from './hydrate';

/**
 * 在页面顶层调用,一次性读取 SSR 注入的本页数据。
 *
 * 用法:
 * ```tsx
 * function Home() {
 *   const ssr = useSSRPage<HomeSSRData>('home');
 *   const [problems, setProblems] = useState(ssr?.problems ?? []);
 *   // ...
 *   // 跳过首屏拉取 effect:
 *   useSkipFirstFetch(ssr);
 * }
 * ```
 *
 * - 同一页面多次调用安全(ref 内缓存,实际消费一次)
 * - SSR 未注入时返回 null,页面走原有的客户端拉取逻辑
 */
export function useSSRPage<T = unknown>(pageKey: string): T | null {
  const ref = useRef<T | null>(undefined);
  if (ref.current === undefined) {
    ref.current = consumeSSRPageData(pageKey) as T | null;
  }
  return ref.current;
}

/**
 * 配合 useSSRPage 使用:若 SSR 已注入数据,则阻止首次 useEffect 触发的拉取。
 *
 * 用法:
 * ```tsx
 * const ssr = useSSRPage('home');
 * useSkipFirstFetch(ssr);
 * useEffect(() => { fetchAll(); }, []);
 * ```
 *
 * 实现机制:挂一个内部 ref 标记首次 effect 是否已执行,首次执行时如果
 * ssr 非空则跳过(不调用 fetch)。后续重渲染不影响。
 *
 * 注意:此 hook 必须在所有 useEffect 之前调用,以确保 ref 已初始化。
 */
export function useSkipFirstFetch(ssrData: unknown | null): void {
  const skippedRef = useRef(false);
  // 若 SSR 已注入数据,设置 skipped=true 让后续 effect 检测到后跳过
  useEffect(() => {
    if (ssrData && !skippedRef.current) {
      skippedRef.current = true;
    }
  }, [ssrData]);
}

/**
 * 检查当前页面是否被 SSR 渲染过(用于 effect 内部决定是否跳过首次拉取)。
 * 与 useSkipFirstFetch 配合使用。
 *
 * 用法:
 * ```tsx
 * const ssr = useSSRPage('home');
 * useEffect(() => {
 *   if (wasSSRRendered(ssr)) return; // 首次拉取跳过
 *   fetchAll();
 * }, []);
 * ```
 */
export function wasSSRRendered(ssrData: unknown | null): boolean {
  return ssrData != null;
}
