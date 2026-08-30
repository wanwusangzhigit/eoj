import { createElement, Fragment } from 'react';

/**
 * Split text into segments around query matches and wrap matches in <mark>.
 * Case-insensitive matching. Works with both React and plain text.
 */
export function highlightText(text: string, query: string): ReturnType<typeof createElement> | string {
  if (!query || !text) return text;

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);

  if (parts.length === 1) return text;

  return createElement(Fragment, null,
    ...parts.map((part, i) =>
      regex.test(part)
        ? createElement('mark', { key: i, className: 'search-highlight' }, part)
        : part
    )
  );
}

/**
 * Extract a snippet of text around the first match of query.
 * Returns { before, match, after } or null if no match.
 */
export function extractSnippet(text: string, query: string, contextLen = 40): { before: string; match: string; after: string } | null {
  if (!query || !text) return null;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, 'i');
  const match = regex.exec(text);
  if (!match) return null;

  const idx = match.index;
  const start = Math.max(0, idx - contextLen);
  const end = Math.min(text.length, idx + query.length + contextLen);
  return {
    before: (start > 0 ? '…' : '') + text.slice(start, idx),
    match: text.slice(idx, idx + query.length),
    after: text.slice(idx + query.length, end) + (end < text.length ? '…' : ''),
  };
}
