import { Hono } from 'hono';
import { AppType } from '../../types';
import { safeParseInt } from '../../utils/helpers';
import { authMiddleware, optionalAuthMiddleware } from '../../middleware/auth';
import { fetchWithTimeout } from '../../utils/fetch-timeout';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

// 审计 #H-21: 图片扩展名白名单，禁止包含路径分隔符（防止 `evil.png/sub/exploit` 污染 GitHub 仓库目录）。
const ALLOWED_IMAGE_EXTENSIONS: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

// 通用文件上传白名单:扩展名 -> 允许的 MIME 类型(以服务端映射为准,不信任客户端声明)
const ALLOWED_FILE_EXTENSIONS: Record<string, string[]> = {
  pdf: ['application/pdf'],
  zip: ['application/zip', 'application/x-zip-compressed'],
  txt: ['text/plain'],
  md: ['text/markdown', 'text/plain'],
  doc: ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xls: ['application/vnd.ms-excel'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ppt: ['application/vnd.ms-powerpoint'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  csv: ['text/csv', 'text/plain'],
  json: ['application/json'],
  cpp: ['text/plain'],
  c: ['text/plain'],
  py: ['text/plain'],
  java: ['text/plain'],
  js: ['text/plain'],
  ts: ['text/plain'],
  go: ['text/plain'],
  rs: ['text/plain'],
};

// 下载时安全的内联类型(仅图片);其余一律 attachment,防止存储型 XSS
function isInlineSafeMime(mime: string): boolean {
  return ALLOWED_IMAGE_TYPES.includes(mime);
}

// 校验图片文件真实内容(magic bytes),防止伪造 MIME 上传非图片/SVG 脚本
function verifyImageSignature(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer.slice(0, 16));
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  // GIF: 47 49 46 38 ("GIF8")
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return true;
  // WebP: "RIFF" .... "WEBP"
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return true;
  return false;
}

/**
 * Escape a filename for use in Content-Disposition header value (quoted string).
 */
function escapeContentDispositionFilename(name: string): string {
  // RFC 5987: remove characters that cannot appear in a quoted string
  return name.replace(/["\\\r\n]/g, ' ').trim();
}

// Base64 encode that handles large buffers without stack overflow
function encodeBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    chunks.push(String.fromCharCode(...chunk));
  }
  return btoa(chunks.join(''));
}

/**
 * 审计 #H-21: 从 Content-Length 头做早期大小预检。
 *
 * 背景：之前上传端点先用 `parseBody()` / `formData()` 把整个 multipart body 读入内存,
 * 再做 size 校验。Workers 单实例内存仅 128MB，攻击者并发上传 100MB 文件即可 OOM。
 * 现在先检查 Content-Length，给一个略大于实际限制的阈值（4KB 容差用于 form metadata），
 * 若声明长度已超阈值则直接拒绝，避免进入 multipart 解析。
 *
 * 注：Content-Length 可被伪造，但常规客户端/CDN/中间盒都会保留真实值，足以挡住
 * 大多数粗陋的内存消耗攻击；专业攻击者仍可绕过，配合 Workers 平台的请求体大小限制
 * （默认 ~100MB）作为兜底。
 */
function earlySizeReject(c: any, maxBytes: number): Response | null {
  const cl = c.req.header('Content-Length');
  if (!cl) return null;
  const n = parseInt(cl, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  // 给 4KB 容差（multipart boundary、文本字段、metadata）
  if (n > maxBytes + 4096) {
    return c.json({
      success: false,
      error: { message: `Upload too large (max ${maxBytes} bytes)`, code: 'BAD_REQUEST' },
    }, 400);
  }
  return null;
}

/**
 * 审计 #H-21: 从原始文件名提取并校验扩展名（仅允许白名单内的图片扩展）。
 * 返回合法的扩展名（小写）。失败返回错误信息字符串。
 */
function safeImageExt(originalName: string): { ext: string } | { error: string } {
  const rawExt = (originalName.split('.').pop() || '').toLowerCase();
  // 严格校验：必须是白名单中的扩展，且不含路径分隔符（`.` split 后 pop 仅返回最后段，
  // 但若用户文件名是 `evil.png/sub/exploit`，pop 结果会含 `/`，因此再加一遍正则）。
  if (!rawExt || !/^[a-z0-9]+$/.test(rawExt)) {
    return { error: `Invalid image extension. Allowed: ${Object.keys(ALLOWED_IMAGE_EXTENSIONS).join(', ')}` };
  }
  if (!ALLOWED_IMAGE_EXTENSIONS[rawExt]) {
    return { error: `Invalid image extension. Allowed: ${Object.keys(ALLOWED_IMAGE_EXTENSIONS).join(', ')}` };
  }
  return { ext: rawExt };
}

const uploads = new Hono<AppType>();

// Upload image
uploads.post('/image', authMiddleware, async (c) => {
  const user = c.get('user');

  // Check if image upload is enabled (upload_admin and super admin can bypass)
  const hasUploadAdmin = user.role === 'admin' || user.role === 'super_admin' || user.userId === 1 || (user.permissions || []).includes('upload_admin');
  let imageUploadEnabled = true;
  try {
    const row: any = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'image_upload_enabled'").first();
    if (row && row.value === 'false') imageUploadEnabled = false;
  } catch { /* ignore */ }

  if (!imageUploadEnabled && !hasUploadAdmin) {
    return c.json({ success: false, error: { message: 'Image upload is disabled', code: 'FORBIDDEN' } }, 403);
  }

  // 审计 #H-21: Content-Length 早期预检，避免 parseBody() 把超大 body 全量读入内存。
  const early = earlySizeReject(c, MAX_IMAGE_SIZE);
  if (early) return early;

  const body = await c.req.parseBody();
  const file = body['file'];
  // 是否公开(默认私有)。审计 #H-13:之前默认 1,用户上传截图忘记勾"私有"
  // 即全网可见,且文件最终通过 GitHub 公开 CDN 提供。改为默认私有:用户必须
  // 显式声明 is_public=true/1/'true'/'1' 才会上传为公开资源。
  const rawIsPublic: unknown = body['is_public'];
  const isPublic = (() => {
    if (rawIsPublic === true || rawIsPublic === 1) return 1;
    if (typeof rawIsPublic === 'string' && (rawIsPublic === 'true' || rawIsPublic === '1')) return 1;
    return 0;
  })();

  if (!file || !(file instanceof File)) {
    return c.json({ success: false, error: { message: 'No file provided', code: 'BAD_REQUEST' } }, 400);
  }

  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return c.json({ success: false, error: { message: 'Invalid image type. Allowed: jpg, png, gif, webp', code: 'BAD_REQUEST' } }, 400);
  }

  if (file.size > MAX_IMAGE_SIZE) {
    return c.json({ success: false, error: { message: 'Image too large (max 5MB)', code: 'BAD_REQUEST' } }, 400);
  }

  // 审计 #H-21: 扩展名严格白名单校验，防止路径分隔符污染 GitHub 仓库目录。
  const extInfo = safeImageExt(file.name);
  if ('error' in extInfo) {
    return c.json({ success: false, error: { message: extInfo.error, code: 'BAD_REQUEST' } }, 400);
  }

  // 校验文件真实内容(防止伪造 MIME 上传 SVG 等非白名单图片)
  const sigBuffer = await file.arrayBuffer();
  if (!verifyImageSignature(sigBuffer)) {
    return c.json({ success: false, error: { message: 'File content does not match an allowed image type', code: 'BAD_REQUEST' } }, 400);
  }

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `${dateStr}_${user.userId}.${extInfo.ext}`;
  const githubPath = `uploads/image/${user.userId}/${filename}`;

  // Upload to GitHub
  const content = encodeBase64(sigBuffer);

  const githubResponse = await fetchWithTimeout(
    `https://api.github.com/repos/${c.env.JUDGE_REPO}/contents/${githubPath}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${c.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'OJ-System',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `Upload image: ${file.name}`,
        content,
      }),
    }
  );

  if (!githubResponse.ok) {
    const errText = await githubResponse.text();
    console.error('GitHub upload failed:', githubResponse.status, errText.slice(0, 200));
    return c.json({ success: false, error: { message: 'Failed to upload image', code: 'INTERNAL_ERROR' } }, 500);
  }

  // Save to database
  const result = await c.env.DB.prepare(
    'INSERT INTO uploads (user_id, filename, original_name, file_type, mime_type, size_bytes, github_path, is_public) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(user.userId, filename, file.name, 'image', file.type, file.size, githubPath, isPublic).run();

  const uploadId = result.meta.last_row_id;

  // Use proxy URL since GitHub repo is private
  const url = `/api/v1/uploads/download/${uploadId}`;

  return c.json({
    success: true,
    data: {
      id: uploadId,
      url,
      filename,
      original_name: file.name,
      file_type: 'image',
      size_bytes: file.size,
      is_public: isPublic,
    },
  });
});

// Upload file
uploads.post('/file', authMiddleware, async (c) => {
  const user = c.get('user');

  // Check if file upload is enabled (upload_admin and super admin can bypass)
  const hasUploadAdmin = user.role === 'admin' || user.role === 'super_admin' || user.userId === 1 || (user.permissions || []).includes('upload_admin');
  let uploadEnabled = true;
  try {
    const row: any = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'upload_enabled'").first();
    if (row && row.value === 'false') uploadEnabled = false;
  } catch { /* ignore */ }

  if (!uploadEnabled && !hasUploadAdmin) {
    return c.json({ success: false, error: { message: 'File upload is disabled', code: 'FORBIDDEN' } }, 403);
  }

  // 审计 #H-21: Content-Length 早期预检。
  const early = earlySizeReject(c, MAX_FILE_SIZE);
  if (early) return early;

  const body = await c.req.parseBody();
  const file = body['file'];
  // 是否公开(默认私有)。审计 #H-13:之前默认 1,用户上传文件忘记勾"私有"
  // 即全网可见,且文件最终通过 GitHub 公开 CDN 提供。改为默认私有:用户必须
  // 显式声明 is_public=true/1/'true'/'1' 才会上传为公开资源。
  const rawIsPublic: unknown = body['is_public'];
  const isPublic = (() => {
    if (rawIsPublic === true || rawIsPublic === 1) return 1;
    if (typeof rawIsPublic === 'string' && (rawIsPublic === 'true' || rawIsPublic === '1')) return 1;
    return 0;
  })();

  if (!file || !(file instanceof File)) {
    return c.json({ success: false, error: { message: 'No file provided', code: 'BAD_REQUEST' } }, 400);
  }

  if (file.size > MAX_FILE_SIZE) {
    return c.json({ success: false, error: { message: 'File too large (max 20MB)', code: 'BAD_REQUEST' } }, 400);
  }

  // 扩展名 + MIME 白名单校验(双重要求),拒绝 HTML/SVG/脚本等可执行内容,
  // 防止存储型 XSS;存储的 mime 以服务端映射为准,不信任客户端声明。
  // 审计 #H-21: 扩展名额外校验不允许包含非字母数字字符（防止 `/` 污染路径）。
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!ext || !/^[a-z0-9]+$/.test(ext)) {
    return c.json({
      success: false,
      error: {
        message: `Invalid file extension. Allowed extensions: ${Object.keys(ALLOWED_FILE_EXTENSIONS).join(', ')}`,
        code: 'BAD_REQUEST',
      },
    }, 400);
  }
  const allowedMimes = ALLOWED_FILE_EXTENSIONS[ext];
  if (!allowedMimes) {
    return c.json({
      success: false,
      error: {
        message: `Invalid file type. Allowed extensions: ${Object.keys(ALLOWED_FILE_EXTENSIONS).join(', ')}`,
        code: 'BAD_REQUEST',
      },
    }, 400);
  }
  if (!allowedMimes.includes(file.type)) {
    return c.json({ success: false, error: { message: 'File content type does not match its extension', code: 'BAD_REQUEST' } }, 400);
  }
  const storedMime = allowedMimes[0];

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `${dateStr}_${user.userId}.${ext}`;
  const githubPath = `uploads/file/${user.userId}/${filename}`;

  // Upload to GitHub
  const arrayBuffer = await file.arrayBuffer();
  const content = encodeBase64(arrayBuffer);

  const githubResponse = await fetchWithTimeout(
    `https://api.github.com/repos/${c.env.JUDGE_REPO}/contents/${githubPath}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${c.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'OJ-System',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `Upload file: ${file.name}`,
        content,
      }),
    }
  );

  if (!githubResponse.ok) {
    const errText = await githubResponse.text();
    console.error('GitHub upload failed:', githubResponse.status, errText.slice(0, 200));
    return c.json({ success: false, error: { message: 'Failed to upload file', code: 'INTERNAL_ERROR' } }, 500);
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO uploads (user_id, filename, original_name, file_type, mime_type, size_bytes, github_path, is_public) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(user.userId, filename, file.name, 'file', storedMime, file.size, githubPath, isPublic).run();

  const uploadId = result.meta.last_row_id;

  // Use proxy URL since GitHub repo is private
  const url = `/api/v1/uploads/download/${uploadId}`;

  return c.json({
    success: true,
    data: {
      id: uploadId,
      url,
      filename,
      original_name: file.name,
      file_type: 'file',
      size_bytes: file.size,
      is_public: isPublic,
    },
  });
});

// List uploads
uploads.get('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20')));
  const fileType = c.req.query('type') || '';
  const offset = (page - 1) * pageSize;

  // Check if user has upload_admin permission
  const hasUploadAdmin = user.role === 'admin' || user.role === 'super_admin' || user.userId === 1 || (user.permissions || []).includes('upload_admin');

  let countQuery = 'SELECT COUNT(*) as total FROM uploads u';
  let dataQuery = 'SELECT u.*, us.username FROM uploads u JOIN users us ON u.user_id = us.id';
  const binds: any[] = [];
  const countBinds: any[] = [];

  if (!hasUploadAdmin) {
    countQuery += ' WHERE u.user_id = ?';
    dataQuery += ' WHERE u.user_id = ?';
    binds.push(user.userId);
    countBinds.push(user.userId);
  }

  if (fileType) {
    const prefix = hasUploadAdmin && binds.length === 0 ? ' WHERE' : ' AND';
    countQuery += `${prefix} u.file_type = ?`;
    dataQuery += `${prefix} u.file_type = ?`;
    binds.push(fileType);
    countBinds.push(fileType);
  }

  dataQuery += ' ORDER BY u.created_at DESC LIMIT ? OFFSET ?';

  const countResult = await c.env.DB.prepare(countQuery).bind(...countBinds).first();
  const total = (countResult as any)?.total || 0;

  const results = await c.env.DB.prepare(dataQuery).bind(...binds, pageSize, offset).all();

  // Add proxy URL to each result (GitHub repo is private)
  const uploadsWithUrl = results.results.map((r: any) => ({
    ...r,
    url: `/api/v1/uploads/download/${r.id}`,
  }));

  return c.json({
    success: true,
    data: {
      uploads: uploadsWithUrl,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    },
  });
});

// Proxy file download (needed because GitHub repo is private)
// 公开文件(is_public=1 或图片)任何人可下载;私有文件(is_public=0 且 file 类型)仅本人或 upload_admin 可下载
uploads.get('/download/:id', optionalAuthMiddleware, async (c) => {
  const uploadId = safeParseInt(c.req.param('id'), 0);

  const upload: any = await c.env.DB.prepare('SELECT * FROM uploads WHERE id = ?').bind(uploadId).first();
  if (!upload) {
    return c.json({ success: false, error: { message: 'File not found', code: 'NOT_FOUND' } }, 404);
  }

  // 私有文件鉴权:非公开(is_public=0)的文件/图片仅上传者本人或 upload_admin 可下载
  // 兼容旧数据:历史文件 is_public 可能为 NULL(视为公开);历史图片始终视为公开
  // 鉴权失败时返回 404(而非 403),避免攻击者通过状态码差异枚举文件 ID
  const isPrivate = upload.is_public !== undefined && upload.is_public !== null && upload.is_public !== 1;
  const isLegacyImage = upload.file_type === 'image' && (upload.is_public === undefined || upload.is_public === null);
  if (isPrivate && !isLegacyImage) {
    const user = c.get('user');
    const isUploadAdmin = user && (user.role === 'admin' || user.role === 'super_admin' || user.userId === 1
      || (Array.isArray(user?.permissions) && user.permissions.includes('upload_admin')));
    if (!user || (upload.user_id !== user.userId && !isUploadAdmin)) {
      return c.json({ success: false, error: { message: 'File not found', code: 'NOT_FOUND' } }, 404);
    }
  }

  try {
    const response = await fetchWithTimeout(
      `https://api.github.com/repos/${c.env.JUDGE_REPO}/contents/${upload.github_path}`,
      {
        headers: {
          Authorization: `Bearer ${c.env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github.v3.raw',
          'User-Agent': 'OJ-System',
        },
      }
    );

    if (!response.ok) {
      return c.json({ success: false, error: { message: 'Failed to download file', code: 'INTERNAL_ERROR' } }, 500);
    }

    const data = await response.arrayBuffer();
    const mime = upload.mime_type || 'application/octet-stream';
    c.header('Content-Type', mime);
    // 审计 #H-20: 私有文件必须用 `private, no-store`，否则共享 CDN/反向代理可在 TTL
    // 窗口内向任意匿名用户回放已通过鉴权的响应——一次 A 下载即可被全网共享。
    // 公开文件继续走长缓存；历史图片（is_public IS NULL）按旧规则视为公开。
    const cachePrivate = isPrivate && !isLegacyImage;
    c.header('Cache-Control', cachePrivate ? 'private, no-store' : 'public, max-age=86400');
    // 仅「图片类型且 MIME 在白名单内」允许内联展示;其余一律 attachment 下载,
    // 防止上传 HTML/SVG 等被同源内联解析造成存储型 XSS
    const inline = upload.file_type === 'image' && isInlineSafeMime(mime);
    const disposition = inline ? 'inline' : 'attachment';
    c.header('Content-Disposition', `${disposition}; filename="${escapeContentDispositionFilename(upload.original_name)}"`);
    return c.body(data);
  } catch (e) {
    console.error('GitHub download failed:', e);
    return c.json({ success: false, error: { message: 'Failed to download file', code: 'INTERNAL_ERROR' } }, 500);
  }
});

// Delete upload
uploads.delete('/:id', authMiddleware, async (c) => {
  const user = c.get('user');
  const uploadId = safeParseInt(c.req.param('id'), 0);

  const upload: any = await c.env.DB.prepare('SELECT * FROM uploads WHERE id = ?').bind(uploadId).first();
  if (!upload) {
    return c.json({ success: false, error: { message: 'File not found', code: 'NOT_FOUND' } }, 404);
  }

  const hasUploadAdmin = user.role === 'admin' || user.role === 'super_admin' || user.userId === 1 || (user.permissions || []).includes('upload_admin');
  if (upload.user_id !== user.userId && !hasUploadAdmin) {
    return c.json({ success: false, error: { message: 'Forbidden: cannot delete others\' files', code: 'FORBIDDEN' } }, 403);
  }

  // Delete from GitHub
  try {
    const currentFile = await fetchWithTimeout(
      `https://api.github.com/repos/${c.env.JUDGE_REPO}/contents/${upload.github_path}`,
      {
        headers: {
          Authorization: `Bearer ${c.env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'OJ-System',
        },
      }
    );

    if (currentFile.ok) {
      const fileData = await currentFile.json() as any;
      await fetchWithTimeout(
        `https://api.github.com/repos/${c.env.JUDGE_REPO}/contents/${upload.github_path}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${c.env.GITHUB_TOKEN}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'OJ-System',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: `Delete file: ${upload.original_name}`,
            sha: fileData.sha,
          }),
        }
      );
    }
  } catch (e) {
    console.error('GitHub delete failed:', e);
  }

  // Delete from database
  await c.env.DB.prepare('DELETE FROM uploads WHERE id = ?').bind(uploadId).run();

  return c.json({ success: true, data: { message: 'File deleted' } });
});

/**
 * Avatar upload endpoint
 *
 * 审计 #H-21 重写：
 *  - Content-Length 早期预检，避免 OOM
 *  - 强制 `instanceof File` 运行时校验，杜绝 `as File` 类型断言被绕过
 *  - 扩展名严格白名单（仅 jpg/jpeg/png/gif/webp），防止 `/` 污染仓库目录
 *  - 写入 `uploads` 表（file_type='avatar'），便于审计/删除/统一管理
 *  - 返回代理 URL `/api/v1/uploads/download/:id` 而非 GitHub raw `download_url`
 *    （后者是私有仓库的地址，匿名浏览器无法访问；旧实现直接存 raw URL 会导致
 *    头像渲染失败 + 泄露内部仓库名）
 *
 * 路由定义在 export default 之前，符合常规 ES 模块约定。
 */
uploads.post('/avatar', authMiddleware, async (c) => {
  const user = c.get('user');

  // Content-Length 早期预检
  const early = earlySizeReject(c, MAX_IMAGE_SIZE);
  if (early) return early;

  const formData = await c.req.formData();
  const file = formData.get('file');
  if (!file || !(file instanceof File)) {
    return c.json({ success: false, error: { message: 'No file uploaded or invalid file field', code: 'BAD_REQUEST' } }, 400);
  }

  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return c.json({ success: false, error: { message: 'Invalid image type. Allowed: JPEG, PNG, GIF, WebP', code: 'BAD_REQUEST' } }, 400);
  }

  if (file.size > MAX_IMAGE_SIZE) {
    return c.json({ success: false, error: { message: 'Image too large. Max 5MB', code: 'BAD_REQUEST' } }, 400);
  }

  // 校验文件真实内容(防止伪造 MIME 上传 SVG 等非白名单图片)
  const buffer = await file.arrayBuffer();
  if (!verifyImageSignature(buffer)) {
    return c.json({ success: false, error: { message: 'File content does not match an allowed image type', code: 'BAD_REQUEST' } }, 400);
  }

  // 扩展名严格白名单校验（拒绝含 `/` 的污染扩展名）
  const extInfo = safeImageExt(file.name);
  if ('error' in extInfo) {
    return c.json({ success: false, error: { message: extInfo.error, code: 'BAD_REQUEST' } }, 400);
  }

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const storedFilename = `${dateStr}_${user.userId}.${extInfo.ext}`;
  // 把头像统一存放在 uploads/avatar/<userId>/ 目录下，便于按用户聚合管理与批量删除
  const githubPath = `uploads/avatar/${user.userId}/${storedFilename}`;

  const base64 = encodeBase64(buffer);

  try {
    const githubResponse = await fetchWithTimeout(
      `https://api.github.com/repos/${c.env.JUDGE_REPO}/contents/${githubPath}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${c.env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'OJ-System',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: `Upload avatar for user ${user.userId}`,
          content: base64,
        }),
      }
    );

    if (!githubResponse.ok) {
      const err = await githubResponse.text();
      console.error('GitHub upload error:', githubResponse.status, err.slice(0, 200));
      return c.json({ success: false, error: { message: 'Failed to upload avatar', code: 'INTERNAL_ERROR' } }, 500);
    }

    // 写入 uploads 表（file_type='avatar'）便于审计、列表展示与批量清理
    const result = await c.env.DB.prepare(
      'INSERT INTO uploads (user_id, filename, original_name, file_type, mime_type, size_bytes, github_path, is_public) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(user.userId, storedFilename, file.name, 'avatar', file.type, file.size, githubPath, 1).run();
    const uploadId = result.meta.last_row_id;

    // 使用代理 URL：GitHub 私有仓库的 raw download_url 浏览器无法匿名访问，
    // 改走 /api/v1/uploads/download/:id 由 Worker 携带 GITHUB_TOKEN 代理下载。
    const avatarUrl = `/api/v1/uploads/download/${uploadId}`;

    // Update user's avatar_url
    await c.env.DB.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').bind(avatarUrl, user.userId).run();

    return c.json({ success: true, data: { avatar_url: avatarUrl, message: 'Avatar updated' } });
  } catch (e) {
    console.error('Avatar upload error:', e);
    return c.json({ success: false, error: { message: 'Failed to upload avatar', code: 'INTERNAL_ERROR' } }, 500);
  }
});

export default uploads;
