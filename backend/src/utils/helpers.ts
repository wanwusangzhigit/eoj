export const LANGUAGE_EXT: Record<string, string> = {
  python: 'py',
  cpp: 'cpp',
  java: 'java',
  javascript: 'js',
  c: 'c',
  go: 'go',
  rust: 'rs',
};

export function getLanguageExt(language: string): string {
  return LANGUAGE_EXT[language] || 'txt';
}

export function jsonResponse<T>(data: T, status = 200) {
  return Response.json(data, { status });
}

export function paginate(page: number, pageSize: number, total: number) {
  const totalPages = Math.ceil(total / pageSize);
  return {
    page,
    pageSize,
    total,
    totalPages,
  };
}

/**
 * Parse page/pageSize from query params with sensible defaults and bounds.
 */
export function parsePagination(
  query: { page?: string; pageSize?: string },
  defaultPageSize = 20,
  maxPageSize = 50,
): { page: number; pageSize: number; offset: number } {
  const page = Math.max(1, parseInt(query.page || '1'));
  const pageSize = Math.min(maxPageSize, Math.max(1, parseInt(query.pageSize || String(defaultPageSize))));
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}
