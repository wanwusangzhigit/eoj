import { Hono } from 'hono';
import { AppType } from '../types';

const rss = new Hono<AppType>();

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function rfc822(dateStr: string | null | undefined): string {
  if (!dateStr) return new Date().toUTCString();
  const d = new Date(String(dateStr).replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? new Date().toUTCString() : d.toUTCString();
}

function buildFeed(c: any, title: string, description: string, items: { title: string; link: string; description?: string; pubDate: string }[]): string {
  const siteUrl = c.env.FRONTEND_URL || 'https://example.com';
  const lastBuild = items.length > 0 ? rfc822(items[0].pubDate) : new Date().toUTCString();
  const itemXml = items.map((it) =>
    `    <item>\n` +
    `      <title>${xmlEscape(it.title)}</title>\n` +
    `      <link>${xmlEscape(it.link)}</link>\n` +
    (it.description ? `      <description>${xmlEscape(it.description)}</description>\n` : '') +
    `      <pubDate>${rfc822(it.pubDate)}</pubDate>\n` +
    `      <guid isPermaLink="false">${xmlEscape(it.link)}</guid>\n` +
    `    </item>`
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${xmlEscape(title)}</title>
    <link>${xmlEscape(siteUrl)}</link>
    <description>${xmlEscape(description)}</description>
    <language>zh-cn</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
${itemXml}
  </channel>
</rss>`;
}

// GET /rss/announcements — 公告 RSS
rss.get('/announcements', async (c) => {
  const results = await c.env.DB.prepare(
    `SELECT id, title, content, created_at FROM site_announcements
     WHERE status = 'published' ORDER BY created_at DESC LIMIT 20`
  ).all();

  const items = (results.results as any[]).map((a) => ({
    title: a.title,
    link: `${c.env.FRONTEND_URL || ''}/announcements`,
    description: a.content ? a.content.substring(0, 500) : '',
    pubDate: a.created_at,
  }));

  const xml = buildFeed(c, '公告 - OJ', '最新公告', items);
  c.header('Content-Type', 'application/rss+xml; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=300');
  return c.body(xml);
});

// GET /rss/blogs — 博客 RSS
rss.get('/blogs', async (c) => {
  const results = await c.env.DB.prepare(
    `SELECT b.id, b.title, b.content, b.created_at, u.username
     FROM blogs b JOIN users u ON b.user_id = u.id
     WHERE b.status = 'published' ORDER BY b.created_at DESC LIMIT 20`
  ).all();

  const items = (results.results as any[]).map((b) => ({
    title: b.title,
    link: `${c.env.FRONTEND_URL || ''}/blogs/${b.id}`,
    description: b.content ? b.content.substring(0, 500) : '',
    pubDate: b.created_at,
  }));

  const xml = buildFeed(c, '博客 - OJ', '最新博客', items);
  c.header('Content-Type', 'application/rss+xml; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=300');
  return c.body(xml);
});

// GET /rss/solutions — 题解 RSS
rss.get('/solutions', async (c) => {
  const results = await c.env.DB.prepare(
    `SELECT s.id, s.title, s.content, s.created_at, u.username, p.title as problem_title
     FROM solutions s JOIN users u ON s.user_id = u.id JOIN problems p ON s.problem_id = p.id
     WHERE s.review_status = 'approved' ORDER BY s.created_at DESC LIMIT 20`
  ).all();

  const items = (results.results as any[]).map((s) => ({
    title: `[${s.problem_title}] ${s.title}`,
    link: `${c.env.FRONTEND_URL || ''}/solutions/${s.id}`,
    description: s.content ? s.content.substring(0, 500) : '',
    pubDate: s.created_at,
  }));

  const xml = buildFeed(c, '题解 - OJ', '最新通过审核的题解', items);
  c.header('Content-Type', 'application/rss+xml; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=300');
  return c.body(xml);
});

// GET /rss — 综合 RSS(公告+博客+题解混合)
rss.get('/', async (c) => {
  const [ann, blogs, sols] = await Promise.all([
    c.env.DB.prepare(
      `SELECT 'announcement' as kind, id, title, content, created_at FROM site_announcements WHERE status = 'published' ORDER BY created_at DESC LIMIT 10`
    ).all(),
    c.env.DB.prepare(
      `SELECT 'blog' as kind, id, title, content, created_at FROM blogs WHERE status = 'published' ORDER BY created_at DESC LIMIT 10`
    ).all(),
    c.env.DB.prepare(
      `SELECT 'solution' as kind, id, title, content, created_at FROM solutions WHERE review_status = 'approved' ORDER BY created_at DESC LIMIT 10`
    ).all(),
  ]);

  const base = c.env.FRONTEND_URL || '';
  const items: { title: string; link: string; description: string; pubDate: string }[] = [];
  for (const row of (ann.results as any[])) {
    items.push({ title: `[公告] ${row.title}`, link: `${base}/announcements`, description: (row.content || '').substring(0, 500), pubDate: row.created_at });
  }
  for (const row of (blogs.results as any[])) {
    items.push({ title: `[博客] ${row.title}`, link: `${base}/blogs/${row.id}`, description: (row.content || '').substring(0, 500), pubDate: row.created_at });
  }
  for (const row of (sols.results as any[])) {
    items.push({ title: `[题解] ${row.title}`, link: `${base}/solutions/${row.id}`, description: (row.content || '').substring(0, 500), pubDate: row.created_at });
  }
  items.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());

  const xml = buildFeed(c, 'OJ - 综合订阅', '公告 / 博客 / 题解 最新更新', items.slice(0, 30));
  c.header('Content-Type', 'application/rss+xml; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=300');
  return c.body(xml);
});

export default rss;
