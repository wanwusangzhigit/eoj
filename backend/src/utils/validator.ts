const VALID_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VALID_USERNAME = /^[a-zA-Z0-9_]{3,20}$/;
const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_LANGUAGES = ['python', 'cpp', 'java', 'javascript', 'c', 'go', 'rust'];
const MAX_SOURCE_CODE_LENGTH = 65535;

export function validateSlug(slug: string): string | null {
  if (!slug || slug.trim().length === 0) return 'Slug is required';
  if (!VALID_SLUG.test(slug)) return 'Slug must only contain lowercase letters, numbers, and hyphens';
  if (slug.length > 100) return 'Slug must be at most 100 characters';
  return null;
}

export function validateUsername(username: string): string | null {
  if (!username || username.trim().length === 0) return 'Username is required';
  if (!VALID_USERNAME.test(username)) return 'Username must be 3-20 characters, only letters, numbers, and underscores';
  return null;
}

export function validateEmail(email: string): string | null {
  if (!email || email.trim().length === 0) return 'Email is required';
  if (!VALID_EMAIL.test(email)) return 'Invalid email format';
  return null;
}

// 常见弱密码黑名单(小写比较),防止用户使用极易被字典攻击的密码
const COMMON_PASSWORDS = new Set([
  '123456', '12345678', '123456789', '1234567890', 'password', 'password1',
  'password123', 'qwerty', 'qwerty123', 'abc123', '111111', '000000',
  'iloveyou', 'admin', 'admin123', 'letmein', 'welcome', 'monkey',
  'dragon', 'football', 'baseball', 'sunshine', 'princess', 'superman',
  '1234567', '12345', '123123', '654321', '666666', '888888', 'a123456',
  'aa123456', 'passw0rd', 'test123', '1q2w3e4r', 'asdfgh', 'zxcvbn',
]);

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

/**
 * 统一密码强度校验(注册/改密/重置共用)。
 * 要求:8-128 位,同时包含大小写字母、数字、特殊字符,且不在常见弱密码黑名单中。
 */
export function validatePassword(password: string): string | null {
  if (!password) return 'Password is required';
  if (password.length < MIN_PASSWORD_LENGTH) return `Password too short (min ${MIN_PASSWORD_LENGTH} characters)`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Password too long (max ${MAX_PASSWORD_LENGTH} characters)`;
  if (!/[A-Z]/.test(password)) return 'Password must include at least one uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must include at least one lowercase letter';
  if (!/[0-9]/.test(password)) return 'Password must include at least one digit';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must include at least one special character';
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return 'Password is too common, please choose a stronger one';
  return null;
}

export function validateSourceCode(sourceCode: string): string | null {
  if (!sourceCode || sourceCode.trim().length === 0) return 'Source code is required';
  if (sourceCode.length > MAX_SOURCE_CODE_LENGTH) return `Source code must be at most ${MAX_SOURCE_CODE_LENGTH} characters`;
  return null;
}

export function validateLanguage(language: string): string | null {
  if (!language) return 'Language is required';
  if (!ALLOWED_LANGUAGES.includes(language)) return `Language must be one of: ${ALLOWED_LANGUAGES.join(', ')}`;
  return null;
}
