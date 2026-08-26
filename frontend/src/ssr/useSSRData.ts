import { useEffect, useState, useCallback, useRef } from 'react';
import { consumeSSRPageData } from './hydrate';

/**
 * useSSRData:页面级数据 hook,SSR 数据优先,无则触发拉取。
 *
 * 用法:
 * ```ts
 * const { data, loading, error, reload } = useSSRData('home', async () => api.getProblems());
 * ```
 *
 * - SSR 时若 loader 已注入 `home` 数据,首次 render 直接返回,loading=false
 * - 客户端首次访问该路由(SSR 未渲染或缓存已清),loading=true 触发 fetch
 * - 后续路由内 navigate 重新进入该页面,loading=true 触发 fetch
 *
 * @param pageKey 与 SSR loader 约定的唯一 key
 * @param fetcher 客户端拉取函数(SSR 未命中时使用)
 */
export function useSSRData<T>(
  pageKey: string,
  fetcher: () => Promise<T>,
): {
  data: T | null;
  loading: boolean;
  error: Error | null;
  reload: () => Promise<void>;
} {
  // 在 useRef 初始化器里消费一次 SSR 缓存(整个组件生命周期内只消费一次)
  const ssrInitialRef = useRef<T | null>(null);
  if (!ssrInitialRef.current) {
    const init = consumeSSRPageData(pageKey) as T | null;
    if (init !== null) {
      ssrInitialRef.current = init;
    }
  }
  const ssrHit = ssrInitialRef.current !== null;

  const [data, setData] = useState<T | null>(ssrInitialRef.current);
  const [loading, setLoading] = useState<boolean>(!ssrHit);
  const [error, setError] = useState<Error | null>(null);

  // fetcher 引用变更时不自动重拉(避免闭包抖动);依赖只挂 ssrHit 与 reload 引用
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcherRef.current();
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // SSR 已注入数据则跳过首次拉取
    if (ssrHit) return;
    reload();
    // 仅在 SSR 是否命中变化时触发(同一组件实例生命周期内通常只触发一次)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ssrHit]);

  return { data, loading, error, reload };
}
