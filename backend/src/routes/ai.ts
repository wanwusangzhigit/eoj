import { Hono } from 'hono';
import { AppType } from '../types';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { fetchTestcases } from '../utils/github-testcases';
import { DEFAULT_AI_SYSTEM_PROMPT } from '../ai-default-prompt';

const ai = new Hono<AppType>();

interface AIModelConfig {
  id: string;
  model: string;
  display_name: string;
  enabled: boolean;
  temperature?: string;
  max_tokens?: string;
}

// Helper: get AI settings from DB
async function getAISettings(c: any): Promise<Record<string, string>> {
  const keys = [
    'ai_enabled',
    'ai_provider',
    'ai_api_key',
    'ai_base_url',
    'ai_model',
    'ai_allowed_models',
    'ai_models_config',
    'ai_chat_enabled',
    'ai_completion_enabled',
    'ai_system_prompt',
    'ai_max_tokens',
    'ai_temperature',
  ];
  const placeholders = keys.map(() => '?').join(',');
  const results = await c.env.DB.prepare(
    `SELECT key, value FROM settings WHERE key IN (${placeholders})`
  ).bind(...keys).all();
  const map: Record<string, string> = {};
  for (const row of results.results as any[]) {
    map[row.key] = row.value;
  }
  return map;
}

// Helper: parse models config JSON; falls back to legacy comma-separated list
function getModelsConfig(settings: Record<string, string>): AIModelConfig[] {
  const raw = settings.ai_models_config;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((m: any) => m && typeof m.model === 'string');
      }
    } catch {
      // fall through to legacy
    }
  }
  // Legacy: parse comma-separated ai_allowed_models
  const legacy = (settings.ai_allowed_models || '')
    .split(',')
    .map((m: string) => m.trim())
    .filter((m: string) => m.length > 0);
  return legacy.map((m: string) => ({
    id: m,
    model: m,
    display_name: m,
    enabled: true,
  }));
}

// Helper: get enabled models (for client consumption)
function getEnabledModels(models: AIModelConfig[]): { model: string; display_name: string }[] {
  return models
    .filter((m) => m.enabled)
    .map((m) => ({ model: m.model, display_name: m.display_name || m.model }));
}

// Helper: check if user can use AI
function canUseAI(user: any, settings: Record<string, string>): boolean {
  // Admins/super admins can always use AI
  if (user.role === 'admin' || user.role === 'super_admin' || user.userId === 1) return true;
  // Check if AI is enabled for regular users
  return settings.ai_enabled === 'true';
}

// ============================================================
// AI Tool definitions & executors
// ============================================================

interface ToolDef {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

// Unified tool definitions — converted to provider-specific formats at call time
const AI_TOOLS: ToolDef[] = [
  {
    name: 'get_problem',
    description: '获取题目完整信息（描述、输入输出格式、样例、时间/内存限制、难度、标签）。当用户询问某道题目时使用。',
    parameters: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: '题目的 URL slug，例如 "two-sum"' },
      },
      required: ['slug'],
    },
  },
  {
    name: 'list_problems',
    description: '搜索/浏览题目列表。支持按关键词搜索、按难度过滤。返回题目标题、slug、难度、通过率等。',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string', description: '搜索关键词（匹配标题）' },
        difficulty: { type: 'string', enum: ['Easy', 'Medium', 'Hard'], description: '难度筛选' },
        page: { type: 'number', description: '页码，从 1 开始，默认 1' },
      },
    },
  },
  {
    name: 'list_my_submissions',
    description: '获取当前用户的提交记录列表。可按题目和状态过滤。返回提交 ID、题目、语言、状态、分数、时间等。用于了解用户的做题历史和薄弱环节。',
    parameters: {
      type: 'object',
      properties: {
        problem_id: { type: 'number', description: '按题目 ID 过滤' },
        status: { type: 'string', description: '按状态过滤，如 accepted, wrong_answer, time_limit_exceeded 等' },
        page: { type: 'number', description: '页码，从 1 开始，默认 1' },
      },
    },
  },
  {
    name: 'get_submission_detail',
    description: '获取某次提交的完整详情，包括源代码和每个测试点的评测结果（输入、期望输出、实际输出、错误信息、耗时、内存）。这是分析代码失败原因的核心工具。',
    parameters: {
      type: 'object',
      properties: {
        submission_id: { type: 'number', description: '提交 ID' },
      },
      required: ['submission_id'],
    },
  },
  {
    name: 'get_sample_testcases',
    description: '获取题目的样例测试点（公开的样例输入输出）。用于帮用户理解题目要求。',
    parameters: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: '题目的 URL slug' },
      },
      required: ['slug'],
    },
  },
  {
    name: 'get_problem_stats',
    description: '获取题目的统计数据（总提交数、通过数、通过率）。用于了解题目难度。',
    parameters: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: '题目的 URL slug' },
      },
      required: ['slug'],
    },
  },
];

// Convert to OpenAI tools format
function toOpenAITools(tools: ToolDef[]): any[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

// Convert to Anthropic tools format
function toAnthropicTools(tools: ToolDef[]): any[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

// Truncate a string to maxLen, keeping head and tail
function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen / 2) + '\n...[truncated]...\n' + s.slice(-maxLen / 2);
}

// Execute a tool by name; returns JSON string result
async function executeTool(name: string, args: any, user: any, env: any): Promise<string> {
  try {
    switch (name) {
      case 'get_problem':
        return await toolGetProblem(env, args.slug);
      case 'list_problems':
        return await toolListProblems(env, args.search, args.difficulty, args.page);
      case 'list_my_submissions':
        return await toolListMySubmissions(env, user, args.problem_id, args.status, args.page);
      case 'get_submission_detail':
        return await toolGetSubmissionDetail(env, user, args.submission_id);
      case 'get_sample_testcases':
        return await toolGetSampleTestcases(env, args.slug);
      case 'get_problem_stats':
        return await toolGetProblemStats(env, args.slug);
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (e: any) {
    return JSON.stringify({ error: e.message || 'Tool execution failed' });
  }
}

// Tool: get problem by slug
async function toolGetProblem(env: any, slug: string): Promise<string> {
  if (!slug) return JSON.stringify({ error: 'slug is required' });
  const row = await env.DB.prepare(
    'SELECT id, title, slug, description, input_format, output_format, sample_input, sample_output, time_limit, memory_limit, tags, difficulty, judge_type FROM problems WHERE slug = ? AND is_public = 1'
  ).bind(slug).first();
  if (!row) return JSON.stringify({ error: 'Problem not found' });
  return JSON.stringify(row);
}

// Tool: list problems
async function toolListProblems(env: any, search?: string, difficulty?: string, page?: number): Promise<string> {
  const pageNum = Math.max(1, page || 1);
  const pageSize = 10;
  const offset = (pageNum - 1) * pageSize;
  let sql = 'SELECT id, title, slug, tags, difficulty, time_limit, memory_limit FROM problems WHERE is_public = 1';
  const binds: any[] = [];
  if (search) {
    sql += ' AND title LIKE ?';
    binds.push(`%${search}%`);
  }
  if (difficulty) {
    sql += ' AND difficulty = ?';
    binds.push(difficulty);
  }
  sql += ' ORDER BY id ASC LIMIT ? OFFSET ?';
  binds.push(pageSize, offset);
  const result = await env.DB.prepare(sql).bind(...binds).all();
  return JSON.stringify({ problems: result.results, page: pageNum, pageSize });
}

// Tool: list current user's submissions
async function toolListMySubmissions(env: any, user: any, problemId?: number, status?: string, page?: number): Promise<string> {
  const pageNum = Math.max(1, page || 1);
  const pageSize = 15;
  const offset = (pageNum - 1) * pageSize;
  let sql = `SELECT s.id, s.problem_id, s.language, s.status, s.score, s.time_used, s.memory_used, s.created_at,
             p.title as problem_title, p.slug as problem_slug
             FROM submissions s JOIN problems p ON s.problem_id = p.id WHERE s.user_id = ?`;
  const binds: any[] = [user.userId];
  if (problemId) {
    sql += ' AND s.problem_id = ?';
    binds.push(problemId);
  }
  if (status) {
    sql += ' AND s.status = ?';
    binds.push(status);
  }
  sql += ' ORDER BY s.created_at DESC LIMIT ? OFFSET ?';
  binds.push(pageSize, offset);
  const result = await env.DB.prepare(sql).bind(...binds).all();
  return JSON.stringify({ submissions: result.results, page: pageNum, pageSize });
}

// Tool: get submission detail (only own submissions for non-admins)
async function toolGetSubmissionDetail(env: any, user: any, submissionId: number): Promise<string> {
  if (!submissionId) return JSON.stringify({ error: 'submission_id is required' });
  let sql = `SELECT s.id, s.user_id, s.problem_id, s.language, s.source_code, s.status, s.score,
             s.time_used, s.memory_used, s.details, s.created_at,
             p.title as problem_title, p.slug as problem_slug, p.description as problem_description,
             p.time_limit, p.memory_limit, p.input_format, p.output_format
             FROM submissions s JOIN problems p ON s.problem_id = p.id WHERE s.id = ?`;
  const binds: any[] = [submissionId];
  // Non-admins can only view their own submissions
  if (user.role !== 'admin' && user.userId !== 1) {
    sql += ' AND s.user_id = ?';
    binds.push(user.userId);
  }
  const row = await env.DB.prepare(sql).bind(...binds).first();
  if (!row) return JSON.stringify({ error: 'Submission not found or no permission' });
  // Parse details JSON for structured access
  let details: any[] = [];
  try {
    details = JSON.parse((row as any).details || '[]');
  } catch {}
  // Truncate source code to avoid excessive tokens
  const sourceCode = truncate((row as any).source_code || '', 8000);
  // Truncate each test case detail
  const truncatedDetails = details.map((tc: any) => ({
    status: tc.status,
    time_used: tc.time_used,
    memory_used: tc.memory_used,
    score: tc.score,
    input: tc.input ? truncate(tc.input, 2000) : undefined,
    expected_output: tc.expected_output ? truncate(tc.expected_output, 2000) : undefined,
    actual_output: tc.actual_output ? truncate(tc.actual_output, 2000) : undefined,
    error_output: tc.error_output ? truncate(tc.error_output, 1000) : undefined,
  }));
  return JSON.stringify({
    submission: {
      id: (row as any).id,
      language: (row as any).language,
      status: (row as any).status,
      score: (row as any).score,
      time_used: (row as any).time_used,
      memory_used: (row as any).memory_used,
      created_at: (row as any).created_at,
      source_code: sourceCode,
    },
    problem: {
      title: (row as any).problem_title,
      slug: (row as any).problem_slug,
      description: truncate((row as any).problem_description || '', 3000),
      time_limit: (row as any).time_limit,
      memory_limit: (row as any).memory_limit,
      input_format: (row as any).input_format,
      output_format: (row as any).output_format,
    },
    test_results: truncatedDetails,
  });
}

// Tool: get sample testcases
async function toolGetSampleTestcases(env: any, slug: string): Promise<string> {
  if (!slug) return JSON.stringify({ error: 'slug is required' });
  const testcases = await fetchTestcases(env, slug);
  const samples = testcases.filter((tc: any) => tc.is_sample);
  return JSON.stringify({ slug, sample_testcases: samples });
}

// Tool: get problem stats
async function toolGetProblemStats(env: any, slug: string): Promise<string> {
  if (!slug) return JSON.stringify({ error: 'slug is required' });
  const problem = await env.DB.prepare('SELECT id FROM problems WHERE slug = ? AND is_public = 1').bind(slug).first();
  if (!problem) return JSON.stringify({ error: 'Problem not found' });
  const stats = await env.DB.prepare(
    `SELECT COUNT(*) as total,
     SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as accepted
     FROM submissions WHERE problem_id = ?`
  ).bind((problem as any).id).first();
  const total = (stats as any)?.total || 0;
  const accepted = (stats as any)?.accepted || 0;
  return JSON.stringify({
    slug,
    submission_count: total,
    accepted_count: accepted,
    pass_rate: total > 0 ? Math.round((accepted / total) * 10000) / 100 : 0,
  });
}

// Build a short summary of a tool result for the trace
function summarizeToolResult(name: string, resultStr: string): string {
  try {
    const data = JSON.parse(resultStr);
    if (data.error) return `Error: ${data.error}`;
    switch (name) {
      case 'get_problem':
        return `题目: ${data.title} (${data.difficulty})`;
      case 'list_problems':
        return `找到 ${data.problems?.length || 0} 道题目`;
      case 'list_my_submissions':
        return `找到 ${data.submissions?.length || 0} 条提交记录`;
      case 'get_submission_detail':
        return `提交 #${data.submission?.id} (${data.submission?.status}), ${data.test_results?.length || 0} 个测试点`;
      case 'get_sample_testcases':
        return `${data.sample_testcases?.length || 0} 个样例测试点`;
      case 'get_problem_stats':
        return `通过率 ${data.pass_rate}% (${data.accepted_count}/${data.submission_count})`;
      default:
        return 'OK';
    }
  } catch {
    return 'OK';
  }
}

// ============================================================
// Provider callers (support tools)
// ============================================================

// Helper: retry fetch on 429 (rate limit) — up to maxRetries times with exponential backoff
const MAX_RETRY = 10;
const RETRY_BASE_MS = 1000;

async function fetchWithRetry(url: string, init: RequestInit, maxRetries = MAX_RETRY): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, init);
    if (response.status !== 429) return response;
    if (attempt === maxRetries) return response; // 最后一次也返回 429，由调用方处理
    const retryAfter = response.headers.get('Retry-After');
    let waitMs: number;
    if (retryAfter) {
      const parsed = parseInt(retryAfter, 10);
      waitMs = isNaN(parsed) ? RETRY_BASE_MS * Math.pow(2, attempt) : parsed * 1000;
    } else {
      waitMs = RETRY_BASE_MS * Math.pow(2, attempt);
    }
    waitMs = Math.min(waitMs, 60000); // 最大等待 60 秒
    console.warn(`AI API 429 rate limited, retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  // unreachable
  return fetch(url, init);
}

// Helper: call OpenAI-compatible API (also works for Zhipu, Aliyun, etc.)
async function callOpenAI(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: any[],
  options: { max_tokens?: number; temperature?: number; stream?: boolean },
  tools?: any[]
): Promise<Response> {
  const url = baseUrl.replace(/\/$/, '') + '/chat/completions';
  const body: any = {
    model,
    messages,
    ...options,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  return fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
}

// Helper: call Anthropic API
async function callAnthropic(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: any[],
  systemPrompt: string,
  options: { max_tokens?: number; temperature?: number; stream?: boolean },
  tools?: any[]
): Promise<Response> {
  const url = baseUrl.replace(/\/$/, '') + '/messages';
  // Anthropic doesn't accept 'system' role in messages; extract and pass separately
  const systemMessages = messages.filter((m) => m.role === 'system');
  const nonSystemMessages = messages.filter((m) => m.role !== 'system');
  const fullSystem = [systemPrompt, ...systemMessages.map((m) => m.content)].filter(Boolean).join('\n\n');
  const body: any = {
    model,
    messages: nonSystemMessages,
    max_tokens: options.max_tokens || 4096,
    ...options,
  };
  if (fullSystem) {
    body.system = fullSystem;
  }
  if (tools && tools.length > 0) {
    body.tools = tools;
  }
  return fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
}

// Helper: parse a streaming SSE response from OpenAI-compatible API
// Yields text deltas; resolves with tool_calls if any
async function parseOpenAIStream(
  response: Response,
  onToken: (text: string) => void
): Promise<{ toolCalls: { id: string; name: string; arguments: string }[] }> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;
        try {
          const chunk = JSON.parse(trimmed.slice(6));
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;
          // Text content
          if (delta.content) {
            onToken(delta.content);
          }
          // Tool calls (accumulated)
          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallsMap.has(idx)) {
                toolCallsMap.set(idx, { id: tc.id || '', name: '', arguments: '' });
              }
              const entry = toolCallsMap.get(idx)!;
              if (tc.id) entry.id = tc.id;
              if (tc.function?.name) entry.name = tc.function.name;
              if (tc.function?.arguments) entry.arguments += tc.function.arguments;
            }
          }
        } catch {
          // skip malformed chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { toolCalls: Array.from(toolCallsMap.values()) };
}

// Helper: parse a streaming SSE response from Anthropic API
async function parseAnthropicStream(
  response: Response,
  onToken: (text: string) => void
): Promise<{ toolCalls: { id: string; name: string; arguments: string }[] }> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>();
  let currentToolIdx = -1;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        try {
          const evt = JSON.parse(trimmed.slice(6));
          if (evt.type === 'content_block_delta') {
            if (evt.delta?.type === 'text_delta' && evt.delta.text) {
              onToken(evt.delta.text);
            } else if (evt.delta?.type === 'input_json_delta' && evt.delta.partial_json) {
              const idx = evt.index ?? 0;
              if (toolCallsMap.has(idx)) {
                toolCallsMap.get(idx)!.arguments += evt.delta.partial_json;
              }
            }
          } else if (evt.type === 'content_block_start') {
            if (evt.content_block?.type === 'tool_use') {
              currentToolIdx = evt.index ?? 0;
              toolCallsMap.set(currentToolIdx, {
                id: evt.content_block.id || '',
                name: evt.content_block.name || '',
                arguments: '',
              });
            }
          }
        } catch {
          // skip
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { toolCalls: Array.from(toolCallsMap.values()) };
}

// Helper: extract response — returns content text and/or tool calls
interface ExtractedResponse {
  content: string;
  toolCalls: { id: string; name: string; arguments: any }[];
}

async function extractResponse(
  provider: string,
  response: Response
): Promise<ExtractedResponse> {
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`AI API error (${response.status}): ${errText}`);
  }
  const data = await response.json();
  if (provider === 'anthropic') {
    const content = data.content;
    if (!Array.isArray(content)) return { content: '', toolCalls: [] };
    let text = '';
    const toolCalls: { id: string; name: string; arguments: any }[] = [];
    for (const block of content) {
      if (block.type === 'text') {
        text += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({ id: block.id, name: block.name, arguments: block.input || {} });
      }
    }
    return { content: text, toolCalls };
  }
  // OpenAI-compatible response format
  const choices = data.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const msg = choices[0].message;
    const content = msg?.content || '';
    const toolCalls: { id: string; name: string; arguments: any }[] = [];
    if (Array.isArray(msg?.tool_calls)) {
      for (const tc of msg.tool_calls) {
        let args = {};
        try { args = JSON.parse(tc.function?.arguments || '{}'); } catch {}
        toolCalls.push({ id: tc.id, name: tc.function?.name || '', arguments: args });
      }
    }
    return { content, toolCalls };
  }
  return { content: '', toolCalls: [] };
}

// POST /ai/chat - AI chat with tool-calling (agentic loop, streaming SSE)
ai.post('/chat', authMiddleware, async (c) => {
  const user = c.get('user');
  const settings = await getAISettings(c);

  if (!canUseAI(user, settings)) {
    return c.json({
      success: false,
      error: { message: 'AI feature is not available', code: 'FORBIDDEN' },
    }, 403);
  }

  if (settings.ai_chat_enabled === 'false') {
    return c.json({
      success: false,
      error: { message: 'AI chat is disabled', code: 'FORBIDDEN' },
    }, 403);
  }

  const apiKey = settings.ai_api_key;
  if (!apiKey) {
    return c.json({
      success: false,
      error: { message: 'AI API key is not configured', code: 'NOT_CONFIGURED' },
    }, 500);
  }

  const provider = settings.ai_provider || 'openai';
  const baseUrl = settings.ai_base_url || (provider === 'anthropic'
    ? 'https://api.anthropic.com/v1'
    : 'https://api.openai.com/v1');
  const defaultModel = settings.ai_model || (provider === 'anthropic'
    ? 'claude-sonnet-4-20250514'
    : 'gpt-4o');
  const systemPrompt = settings.ai_system_prompt || DEFAULT_AI_SYSTEM_PROMPT;
  const globalMaxTokens = parseInt(settings.ai_max_tokens || '4096');
  const globalTemperature = parseFloat(settings.ai_temperature || '0.7');

  const modelsConfig = getModelsConfig(settings);

  const body = await c.req.json();
  const { messages, context, model: clientModel, stream: clientStream } = body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return c.json({
      success: false,
      error: { message: 'Messages are required', code: 'BAD_REQUEST' },
    }, 400);
  }

  const matchedModel = clientModel
    ? modelsConfig.find((m) => m.model === clientModel && m.enabled)
    : undefined;
  const model = matchedModel ? matchedModel.model : defaultModel;
  const maxTokens = matchedModel?.max_tokens
    ? parseInt(matchedModel.max_tokens)
    : globalMaxTokens;
  const temperature = matchedModel?.temperature
    ? parseFloat(matchedModel.temperature)
    : globalTemperature;

  // Build conversation
  const conversationMessages: any[] = [];
  if (provider === 'openai') {
    conversationMessages.push({ role: 'system', content: systemPrompt });
  }
  if (context) {
    conversationMessages.push({ role: 'system', content: `Context:\n${context}` });
  }
  for (const msg of messages) {
    conversationMessages.push({ role: msg.role, content: msg.content });
  }

  const openaiTools = toOpenAITools(AI_TOOLS);
  const anthropicTools = toAnthropicTools(AI_TOOLS);
  const MAX_TOOL_ROUNDS = 8;
  const toolCallTrace: { name: string; arguments: any; result_summary: string }[] = [];

  // If client doesn't request streaming, fall back to non-streaming
  const useStreaming = clientStream === true;

  if (!useStreaming) {
    // ── Non-streaming path (backward compatible) ──
    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        let response: Response;
        if (provider === 'anthropic') {
          response = await callAnthropic(baseUrl, apiKey, model, conversationMessages, systemPrompt, {
            max_tokens: maxTokens, temperature,
          }, anthropicTools);
        } else {
          response = await callOpenAI(baseUrl, apiKey, model, conversationMessages, {
            max_tokens: maxTokens, temperature,
          }, openaiTools);
        }
        const { content, toolCalls } = await extractResponse(provider, response);
        if (!toolCalls || toolCalls.length === 0) {
          return c.json({ success: true, data: { content, model, provider, tool_calls: toolCallTrace } });
        }
        // Execute tools & update conversation (same logic as streaming, see below)
        const tcResult = await processToolCalls(provider, content, toolCalls, conversationMessages, user, c.env, toolCallTrace);
        if (tcResult === 'max_rounds') {
          return c.json({ success: true, data: { content: '（已达到工具调用轮次上限，请继续提问以获取更多信息）', model, provider, tool_calls: toolCallTrace } });
        }
      }
      return c.json({ success: true, data: { content: '', model, provider, tool_calls: toolCallTrace } });
    } catch (e: any) {
      console.error('AI chat error:', e);
      return c.json({ success: false, error: { message: e.message || 'AI request failed', code: 'AI_ERROR' } }, 500);
    }
  }

  // ── Streaming SSE path ──
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: any) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          let response: Response;
          if (provider === 'anthropic') {
            response = await callAnthropic(baseUrl, apiKey, model, conversationMessages, systemPrompt, {
              max_tokens: maxTokens, temperature, stream: true,
            }, anthropicTools);
          } else {
            response = await callOpenAI(baseUrl, apiKey, model, conversationMessages, {
              max_tokens: maxTokens, temperature, stream: true,
            }, openaiTools);
          }

          if (!response.ok) {
            const errText = await response.text();
            send('error', { message: `AI API error (${response.status}): ${errText}` });
            controller.close();
            return;
          }

          let fullContent = '';
          const onToken = (text: string) => {
            fullContent += text;
            send('token', { content: text });
          };

          let parsedToolCalls: { id: string; name: string; arguments: string }[];
          if (provider === 'anthropic') {
            parsedToolCalls = (await parseAnthropicStream(response, onToken)).toolCalls;
          } else {
            parsedToolCalls = (await parseOpenAIStream(response, onToken)).toolCalls;
          }

          // No tool calls → done
          if (parsedToolCalls.length === 0) {
            send('done', { model, provider, tool_calls: toolCallTrace });
            controller.close();
            return;
          }

          // Parse tool call arguments
          const toolCalls = parsedToolCalls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: (() => { try { return JSON.parse(tc.arguments || '{}'); } catch { return {}; } })(),
          }));

          // Send tool_call events & execute
          for (const tc of toolCalls) {
            send('tool_call', { name: tc.name, arguments: tc.arguments });
            const resultStr = await executeTool(tc.name, tc.arguments, user, c.env);
            const summary = summarizeToolResult(tc.name, resultStr);
            toolCallTrace.push({ name: tc.name, arguments: tc.arguments, result_summary: summary });
            send('tool_result', { name: tc.name, result_summary: summary });
          }

          // Update conversation for next round
          if (provider === 'anthropic') {
            const assistantContent: any[] = [];
            if (fullContent) assistantContent.push({ type: 'text', text: fullContent });
            for (const tc of toolCalls) {
              assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments });
            }
            conversationMessages.push({ role: 'assistant', content: assistantContent });
            const toolResults: any[] = [];
            for (const tc of toolCalls) {
              const resultStr = await executeTool(tc.name, tc.arguments, user, c.env);
              toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: resultStr });
            }
            conversationMessages.push({ role: 'user', content: toolResults });
          } else {
            conversationMessages.push({
              role: 'assistant',
              content: fullContent || null,
              tool_calls: toolCalls.map((tc) => ({
                id: tc.id, type: 'function',
                function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
              })),
            });
            for (const tc of toolCalls) {
              const resultStr = await executeTool(tc.name, tc.arguments, user, c.env);
              conversationMessages.push({ role: 'tool', tool_call_id: tc.id, content: resultStr });
            }
          }
        }

        // Max rounds
        send('done', { model, provider, tool_calls: toolCallTrace });
        controller.close();
      } catch (e: any) {
        console.error('AI chat stream error:', e);
        try { send('error', { message: e.message || 'AI request failed' }); } catch {}
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

// Helper: process tool calls for the non-streaming path
async function processToolCalls(
  provider: string,
  content: string,
  toolCalls: { id: string; name: string; arguments: any }[],
  conversationMessages: any[],
  user: any,
  env: any,
  toolCallTrace: { name: string; arguments: any; result_summary: string }[]
): Promise<string | void> {
  if (provider === 'anthropic') {
    const assistantContent: any[] = [];
    if (content) assistantContent.push({ type: 'text', text: content });
    for (const tc of toolCalls) {
      assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments });
    }
    conversationMessages.push({ role: 'assistant', content: assistantContent });
    const toolResults: any[] = [];
    for (const tc of toolCalls) {
      const resultStr = await executeTool(tc.name, tc.arguments, user, env);
      toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: resultStr });
      toolCallTrace.push({ name: tc.name, arguments: tc.arguments, result_summary: summarizeToolResult(tc.name, resultStr) });
    }
    conversationMessages.push({ role: 'user', content: toolResults });
  } else {
    conversationMessages.push({
      role: 'assistant',
      content: content || null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id, type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })),
    });
    for (const tc of toolCalls) {
      const resultStr = await executeTool(tc.name, tc.arguments, user, env);
      conversationMessages.push({ role: 'tool', tool_call_id: tc.id, content: resultStr });
      toolCallTrace.push({ name: tc.name, arguments: tc.arguments, result_summary: summarizeToolResult(tc.name, resultStr) });
    }
  }
}

// POST /ai/complete - AI code completion
ai.post('/complete', authMiddleware, async (c) => {
  const user = c.get('user');
  const settings = await getAISettings(c);

  if (!canUseAI(user, settings)) {
    return c.json({
      success: false,
      error: { message: 'AI feature is not available', code: 'FORBIDDEN' },
    }, 403);
  }

  if (settings.ai_completion_enabled === 'false') {
    return c.json({
      success: false,
      error: { message: 'AI code completion is disabled', code: 'FORBIDDEN' },
    }, 403);
  }

  const apiKey = settings.ai_api_key;
  if (!apiKey) {
    return c.json({
      success: false,
      error: { message: 'AI API key is not configured', code: 'NOT_CONFIGURED' },
    }, 500);
  }

  const provider = settings.ai_provider || 'openai';
  const baseUrl = settings.ai_base_url || (provider === 'anthropic'
    ? 'https://api.anthropic.com/v1'
    : 'https://api.openai.com/v1');
  const defaultModel = settings.ai_model || (provider === 'anthropic'
    ? 'claude-sonnet-4-20250514'
    : 'gpt-4o');
  const globalMaxTokens = parseInt(settings.ai_max_tokens || '4096');
  const globalTemperature = parseFloat(settings.ai_temperature || '0.2');

  // Parse models config (JSON; falls back to legacy comma-separated list)
  const modelsConfig = getModelsConfig(settings);

  const body = await c.req.json();
  const { code, language, problem_title, problem_description, instruction, model: clientModel } = body;

  if (!code) {
    return c.json({
      success: false,
      error: { message: 'Code is required', code: 'BAD_REQUEST' },
    }, 400);
  }

  // Determine model: use client-specified model if enabled, otherwise default
  const matchedModel = clientModel
    ? modelsConfig.find((m) => m.model === clientModel && m.enabled)
    : undefined;
  const model = matchedModel ? matchedModel.model : defaultModel;
  // Per-model overrides
  const maxTokens = matchedModel?.max_tokens
    ? parseInt(matchedModel.max_tokens)
    : globalMaxTokens;
  const temperature = matchedModel?.temperature
    ? parseFloat(matchedModel.temperature)
    : globalTemperature;

  const systemPrompt = `You are a code completion assistant for an online judge system. Complete or improve the user's code. Only output the code, no explanations, no markdown code blocks.`;

  let userContent = `Language: ${language || 'python'}\n`;
  if (problem_title) userContent += `Problem: ${problem_title}\n`;
  if (problem_description) userContent += `Description: ${problem_description}\n`;
  if (instruction) userContent += `Instruction: ${instruction}\n`;
  userContent += `\nCurrent code:\n\`\`\`\n${code}\n\`\`\`\n\nPlease complete or improve the code. Output only the code.`;

  const fullMessages = provider === 'anthropic'
    ? [{ role: 'user', content: userContent }]
    : [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ];

  try {
    let response: Response;
    if (provider === 'anthropic') {
      response = await callAnthropic(baseUrl, apiKey, model, fullMessages, systemPrompt, {
        max_tokens: maxTokens,
        temperature,
      });
    } else {
      response = await callOpenAI(baseUrl, apiKey, model, fullMessages, {
        max_tokens: maxTokens,
        temperature,
      });
    }

    const { content: rawContent } = await extractResponse(provider, response);
    // Strip markdown code blocks if present
    let content = rawContent.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');

    return c.json({ success: true, data: { content, model, provider } });
  } catch (e: any) {
    console.error('AI completion error:', e);
    return c.json({
      success: false,
      error: { message: e.message || 'AI request failed', code: 'AI_ERROR' },
    }, 500);
  }
});

// GET /ai/status - Check if AI is available for the current user
ai.get('/status', authMiddleware, async (c) => {
  const user = c.get('user');
  const settings = await getAISettings(c);

  const enabled = canUseAI(user, settings);
  const hasKey = !!settings.ai_api_key;
  const chatEnabled = settings.ai_chat_enabled !== 'false';
  const completionEnabled = settings.ai_completion_enabled !== 'false';

  // Parse models config (JSON; falls back to legacy comma-separated list)
  const modelsConfig = getModelsConfig(settings);
  const allowedModels = getEnabledModels(modelsConfig);

  return c.json({
    success: true,
    data: {
      available: enabled && hasKey,
      chat_enabled: enabled && hasKey && chatEnabled,
      completion_enabled: enabled && hasKey && completionEnabled,
      provider: settings.ai_provider || 'openai',
      model: settings.ai_model || '',
      allowed_models: allowedModels,
    },
  });
});

// GET /ai/models - Get full models config (admin only)
ai.get('/models', authMiddleware, adminMiddleware, async (c) => {
  const settings = await getAISettings(c);
  const models = getModelsConfig(settings);
  return c.json({ success: true, data: { models } });
});

// PUT /ai/models - Save full models config (admin only)
ai.put('/models', authMiddleware, adminMiddleware, async (c) => {
  const body = await c.req.json();
  const models = body?.models;
  if (!Array.isArray(models)) {
    return c.json({
      success: false,
      error: { message: 'models must be an array', code: 'BAD_REQUEST' },
    }, 400);
  }
  // Sanitize: ensure required fields and types
  const cleaned: AIModelConfig[] = models
    .filter((m: any) => m && typeof m.model === 'string' && m.model.trim())
    .map((m: any, idx: number) => ({
      id: typeof m.id === 'string' && m.id ? m.id : `model-${Date.now()}-${idx}`,
      model: m.model.trim(),
      display_name: typeof m.display_name === 'string' ? m.display_name.trim() : m.model.trim(),
      enabled: m.enabled !== false,
      temperature: typeof m.temperature === 'string' ? m.temperature : '',
      max_tokens: typeof m.max_tokens === 'string' ? m.max_tokens : '',
    }));
  const value = JSON.stringify(cleaned);
  await c.env.DB.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES ('ai_models_config', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')"
  ).bind(value, value).run();
  return c.json({ success: true, data: { models: cleaned } });
});

export default ai;
