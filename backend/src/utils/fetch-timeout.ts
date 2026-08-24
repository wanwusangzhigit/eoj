/**
 * fetch 包装：为所有外部 API 调用（GitHub、CP OAuth、AI Provider 等）增加硬超时。
 * Worker 环境的 fetch 默认没有超时，上游无响应会无限挂起请求，
 * 可能造成连接泄漏和资源耗尽，因此统一通过 AbortController 强制超时。
 */

export const DEFAULT_TIMEOUT_MS = 10_000;
// GitHub 内容上传/下载可能涉及较大文件（如 20MB 上传），放宽到 30s
export const GITHUB_TIMEOUT_MS = 30_000;

function pickTimeout(url: string | URL | Request, timeoutMs?: number): number {
  if (timeoutMs !== undefined) return timeoutMs;
  try {
    const parsed =
      typeof url === 'string' ? new URL(url) : url instanceof URL ? url : new URL(url.url);
    return parsed.hostname === 'api.github.com' ? GITHUB_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
  } catch {
    return DEFAULT_TIMEOUT_MS;
  }
}

export async function fetchWithTimeout(
  url: string | URL | Request,
  init: RequestInit = {},
  timeoutMs?: number
): Promise<Response> {
  const timeout = pickTimeout(url, timeoutMs);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeout}ms: ${String(url)}`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
