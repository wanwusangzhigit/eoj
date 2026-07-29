export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  CPOAUTH_CLIENT_ID: string;
  CPOAUTH_CLIENT_SECRET: string;
  JWT_SECRET: string;
  GITHUB_TOKEN: string;
  CALLBACK_SECRET: string;
  JUDGE_REPO: string;
  FRONTEND_URL: string;
  REGISTRATION_OPEN: string;
  SEND_EMAIL: SendEmail;
  DEFAULT_FROM_EMAIL: string;
}

export interface SendEmail {
  send: (msg: {
    from: { name?: string; email: string };
    to: Array<{ email: string }>;
    subject: string;
    html?: string;
    text?: string;
  }) => Promise<void>;
}

export interface UserPayload {
  id: number;
  userId: number;
  username: string;
  role: string;
  permissions?: string[];
  avatar_url?: string;
  created_at?: string;
}

export type AppType = {
  Bindings: Env;
  Variables: {
    user: UserPayload;
  };
};

// ── Common database row shapes ──

export interface ProblemRow {
  id: number;
  title: string;
  slug: string;
  description: string;
  input_format: string | null;
  output_format: string | null;
  time_limit: number;
  memory_limit: number;
  tags: string;
  difficulty: string;
  is_public: number;
  judge_type: string;
  spj_language: string | null;
  rating: number | null;
  created_at: string;
  updated_at: string;
}

export interface SubmissionRow {
  id: number;
  user_id: number;
  problem_id: number;
  language: string;
  source_code: string;
  status: string;
  score: number | null;
  time_used: number | null;
  memory_used: number | null;
  github_sha: string | null;
  github_run_id: string | null;
  judge_message: string | null;
  details: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserRow {
  id: number;
  username: string;
  avatar_url: string | null;
  bio: string | null;
  role: string;
  permissions: string;
  banned: number;
  password_hash: string | null;
  created_at: string;
}

export interface Testcase {
  input: string;
  expected_output: string;
  is_sample: boolean;
  score: number;
}

export interface PaginationParams {
  page: number;
  pageSize: number;
  offset: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

// ── Generic API response shape (matching Hono json responses) ──

export interface ApiResponse<T = unknown> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: {
    message: string;
    code?: string;
    detail?: string;
  };
}

// ── Common D1 query result helpers ──

/** Shape returned by SELECT COUNT(*) as count queries */
export interface CountResult {
  count: number;
}

/** Shape returned by SELECT COUNT(*) as total queries */
export interface TotalResult {
  total: number;
}

/** A single row from the settings table */
export interface SettingRow {
  key: string;
  value: string;
}

/** A single row from the rate_limits table */
export interface RateLimitRow {
  key: string;
  created_at: number;
}

/** A single row from the audit_logs table */
export interface AuditLogRow {
  id: number;
  user_id: number | null;
  username: string | null;
  ip: string;
  device_fingerprint: string;
  page: string;
  action: string;
  method: string;
  path: string;
  user_agent: string;
  created_at: string;
}
