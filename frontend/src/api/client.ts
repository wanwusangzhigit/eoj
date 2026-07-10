import { useAuthStore } from '../store/auth';
import { getDeviceFingerprint } from '../utils/deviceFingerprint';

const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1';

export interface AIModelConfig {
  id: string;
  model: string;
  display_name: string;
  enabled: boolean;
  temperature?: string;
  max_tokens?: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code: string;
  };
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private getToken(): string | null {
    return localStorage.getItem('token');
  }

  private async request<T>(path: string, options: RequestInit = {}, skipJsonBody?: boolean): Promise<T> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };

    if (!skipJsonBody) {
      headers['Content-Type'] = 'application/json';
    }

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Add device fingerprint header
    try {
      const fingerprint = await getDeviceFingerprint();
      if (fingerprint) {
        headers['X-Device-Fingerprint'] = fingerprint;
      }
    } catch { /* ignore */ }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers,
      });
    } catch {
      throw new Error('Network error. Please check your connection and try again.');
    }

    // Auto-logout on 401
    if (response.status === 401 && token) {
      localStorage.removeItem('token');
      window.dispatchEvent(new Event('auth:expired'));
      throw new Error('Session expired. Please login again.');
    }

    const result: ApiResponse<T> = await response.json().catch(() => ({
      success: false,
      error: {
        message: 'Failed to parse response',
        code: 'PARSE_ERROR'
      }
    }));

    if (!result.success || !response.ok) {
      const message = result.error?.message || `HTTP ${response.status}`;
      throw new Error(message);
    }

    if (result.data === undefined) {
      throw new Error('No data in response');
    }

    return result.data;
  }

  async getProblems(params?: { page?: number; pageSize?: number; search?: string; tag?: string; difficulty?: string }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    if (params?.search) query.set('search', params.search);
    if (params?.tag) query.set('tag', params.tag);
    if (params?.difficulty) query.set('difficulty', params.difficulty);
    return this.request<{ problems: any[]; pagination: any }>(`/problems?${query.toString()}`);
  }

  async getProblemTags() {
    return this.request<{ tags: string[] }>('/problems/tags');
  }

  // Tag categories tree
  async getTagCategories() {
    return this.request<{ categories: any[] }>('/tags/categories');
  }

  // Tags tree with problem counts
  async getTagsTree() {
    return this.request<{ tree: any[] }>('/tags/tree');
  }

  // Problem-specific tags
  async getProblemTagsById(problemId: number) {
    return this.request<{ tags: any[] }>(`/problems/${problemId}/tags`);
  }

  // Set problem tags
  async setProblemTags(problemId: number, tagIds: number[]) {
    return this.request<{ message: string }>(`/problems/${problemId}/tags`, {
      method: 'PUT',
      body: JSON.stringify({ tag_ids: tagIds }),
    });
  }

  // Rating leaderboard
  async getRatingLeaderboard(params?: { page?: number; pageSize?: number }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    return this.request<{ rankings: any[]; pagination: any }>(`/rating/leaderboard?${query.toString()}`);
  }

  // User rating info
  async getUserRating(username: string) {
    return this.request<{ rating: number; max_rating: number; history: any[] }>(`/users/${username}/rating`);
  }

  async getProblem(slug: string) {
    return this.request<{ problem: any; sampleTestcases: any[]; stats: any }>(`/problems/${slug}`);
  }

  async createProblem(data: any) {
    return this.request<{ id: number; message: string }>('/problems', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateProblem(id: number, data: any) {
    return this.request<{ message: string }>(`/problems/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async addTestcases(problemId: number, testcases: any[]) {
    return this.request<{ message: string; count: number }>(`/problems/${problemId}/testcases`, {
      method: 'POST',
      body: JSON.stringify(testcases),
    });
  }

  async submitCode(data: { problem_id: number; language: string; source_code: string }) {
    return this.request<{ submission_id: number; status: string }>('/submissions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getSubmissions(params?: { page?: number; pageSize?: number; problem_id?: string; status?: string; language?: string; user_id?: string }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    if (params?.problem_id) query.set('problem_id', params.problem_id);
    if (params?.status) query.set('status', params.status);
    if (params?.language) query.set('language', params.language);
    if (params?.user_id) query.set('user_id', params.user_id);
    return this.request<{ submissions: any[]; pagination: any }>(`/submissions?${query.toString()}`);
  }

  async getSubmission(id: number) {
    return this.request<{ submission: any }>(`/submissions/${id}`);
  }

  async getSubmissionTestcases(id: number) {
    return this.request<{ testcases: any[] }>(`/submissions/${id}/testcases`);
  }

  async getSubmissionLogs(id: number) {
    return this.request<{ logs: any[] }>(`/submissions/${id}/logs`);
  }

  async rejudgeSubmission(id: number) {
    return this.request<{ submission_id: number; status: string; message: string }>(`/submissions/${id}/rejudge`, {
      method: 'POST',
    });
  }

  async getMe() {
    return this.request<{ user: any }>('/auth/me');
  }

  async register(username: string, password: string, email?: string) {
    return this.request<{ token: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, email }),
    });
  }

  async login(username: string, password: string) {
    return this.request<{ token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  }

  async getRankings(limit?: number, timeRange?: string) {
    const query = new URLSearchParams();
    if (limit) query.set('limit', String(limit));
    if (timeRange) query.set('timeRange', timeRange);
    return this.request<{ rankings: any[] }>(`/rankings?${query.toString()}`);
  }

  async getUserProfile() {
    return this.request<{ user: any; stats: any; recent_submissions: any[] }>('/users/profile');
  }

  async getUserSubmissions(params?: { page?: number; pageSize?: number; status?: string }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    if (params?.status) query.set('status', params.status);
    return this.request<{ submissions: any[]; pagination: any }>(`/users/submissions?${query.toString()}`);
  }

  async getUserSolved() {
    return this.request<{ problems: any[] }>('/users/solved');
  }

  async getUserContests() {
    return this.request<{ contests: any[] }>('/users/contests');
  }

  async getUserByUsername(username: string) {
    return this.request<{ user: any; stats: any; solved_problems: any[]; recent_submissions: any[] }>(`/users/${username}`);
  }

  async getProblemStatus(problemId: number) {
    return this.request<{ solved: boolean; attempted: boolean }>(`/problems/${problemId}/status`);
  }

  async checkFavorite(problemId: number) {
    return this.request<{ is_favorited: boolean }>(`/problems/${problemId}/favorite`);
  }

  async addFavorite(problemId: number) {
    return this.request<{ message: string }>(`/problems/${problemId}/favorite`, {
      method: 'POST',
    });
  }

  async removeFavorite(problemId: number) {
    return this.request<{ message: string }>(`/problems/${problemId}/favorite`, {
      method: 'DELETE',
    });
  }

  async getFavorites(params?: { page?: number; pageSize?: number }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    const qs = query.toString();
    return this.request<{ problems: any[]; pagination: any }>(`/problems/user/favorites${qs ? `?${qs}` : ''}`);
  }

  async getUserList(params?: { page?: number; pageSize?: number; search?: string }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    if (params?.search) query.set('search', params.search);
    const qs = query.toString();
    return this.request<{ users: any[]; pagination: any }>(`/users/list${qs ? `?${qs}` : ''}`);
  }

  async updateUserRole(userId: number, role: string) {
    return this.request<{ message: string }>(`/users/${userId}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    });
  }

  async updateUserPermissions(userId: number, permissions: string[]) {
    return this.request<{ message: string }>(`/users/${userId}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ permissions }),
    });
  }

  async setUserBanned(userId: number, banned: boolean) {
    return this.request<{ message: string }>(`/users/${userId}/ban`, {
      method: 'PUT',
      body: JSON.stringify({ banned }),
    });
  }

  async getAdminStats() {
    return this.request<{
      users: number; problems: number; submissions: number; today_submissions: number;
      accepted: number; contests: number; lists: number; tickets: number; open_tickets: number;
      recent_submissions: any[];
    }>('/admin/stats');
  }

  async getAdminProblems(params?: { page?: number; pageSize?: number; search?: string }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    if (params?.search) query.set('search', params.search);
    return this.request<{ problems: any[]; pagination: any }>(`/admin/problems?${query.toString()}`);
  }

  async deleteProblem(id: number) {
    return this.request<{ message: string }>(`/problems/${id}`, {
      method: 'DELETE',
    });
  }

  async getProblemTestcases(problemId: number) {
    return this.request<{ testcases: any[] }>(`/problems/${problemId}/testcases`);
  }

  async deleteTestcase(problemId: number, index: number) {
    return this.request<{ message: string }>(`/problems/${problemId}/testcases/${index}`, {
      method: 'DELETE',
    });
  }

  async getProblemSpj(problemId: number) {
    return this.request<{ spj_code: string; spj_language: string }>(`/problems/${problemId}/spj`);
  }

  async updateProblemSpj(problemId: number, language: string, code: string) {
    return this.request<{ message: string }>(`/problems/${problemId}/spj`, {
      method: 'PUT',
      body: JSON.stringify({ language, code }),
    });
  }

  async deleteProblemSpj(problemId: number) {
    return this.request<{ message: string }>(`/problems/${problemId}/spj`, {
      method: 'DELETE',
    });
  }

  getGithubAuthUrl() {
    return `${this.baseUrl}/auth/github`;
  }

  // Contests
  async getContests(params?: { page?: number; pageSize?: number; status?: string }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    if (params?.status) query.set('status', params.status);
    return this.request<{ contests: any[]; pagination: any }>(`/contests?${query.toString()}`);
  }

  async getContest(id: number) {
    return this.request<{ contest: any }>(`/contests/${id}`);
  }

  async createContest(data: any) {
    return this.request<{ id: number; message: string }>('/contests', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateContest(id: number, data: any) {
    return this.request<{ message: string }>(`/contests/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteContest(id: number) {
    return this.request<{ message: string }>(`/contests/${id}`, {
      method: 'DELETE',
    });
  }

  async getContestProblems(id: number) {
    return this.request<{ problems: any[] }>(`/contests/${id}/problems`);
  }

  async registerContest(id: number) {
    return this.request<{ message: string }>(`/contests/${id}/register`, {
      method: 'POST',
    });
  }

  async getContestRankings(id: number) {
    return this.request<{
      rankings: any[];
      problems: any[];
      scoring_type?: string;
      is_rated?: number;
      rating_finalized?: number;
    }>(`/contests/${id}/rankings`);
  }

  async checkContestRegistration(id: number) {
    return this.request<{ registered: boolean }>(`/contests/${id}/registration`);
  }

  async getContestMyStatus(id: number) {
    return this.request<{ problems: Record<string, { status: string; score: number; best_score: number }> }>(`/contests/${id}/my-status`);
  }

  // Tickets
  async getTickets(params?: { page?: number; pageSize?: number; status?: string; category?: string }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    if (params?.status) query.set('status', params.status);
    if (params?.category) query.set('category', params.category);
    return this.request<{ tickets: any[]; pagination: any }>(`/tickets?${query.toString()}`);
  }

  async getTicket(id: number) {
    return this.request<{ ticket: any; replies: any[] }>(`/tickets/${id}`);
  }

  async createTicket(data: { title: string; content: string; category?: string; priority?: string }) {
    return this.request<{ id: number; message: string }>('/tickets', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async replyTicket(id: number, content: string) {
    return this.request<{ message: string }>(`/tickets/${id}/replies`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  }

  async updateTicketStatus(id: number, data: { status?: string; priority?: string }) {
    return this.request<{ message: string }>(`/tickets/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // Problem Lists
  async getProblemLists(params?: { page?: number; pageSize?: number; search?: string }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    if (params?.search) query.set('search', params.search);
    return this.request<{ lists: any[]; pagination: any }>(`/lists?${query.toString()}`);
  }

  async getProblemList(id: number) {
    return this.request<{ list: any; items: any[] }>(`/lists/${id}`);
  }

  async createProblemList(data: any) {
    return this.request<{ id: number; message: string }>('/lists', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateProblemList(id: number, data: any) {
    return this.request<{ message: string }>(`/lists/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteProblemList(id: number) {
    return this.request<{ message: string }>(`/lists/${id}`, {
      method: 'DELETE',
    });
  }

  // Admin - Contests
  async getAdminContests(params?: { page?: number; pageSize?: number }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    return this.request<{ contests: any[]; pagination: any }>(`/admin/contests?${query.toString()}`);
  }

  // Admin - Tickets
  async getAdminTickets(params?: { page?: number; pageSize?: number; status?: string }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    if (params?.status) query.set('status', params.status);
    return this.request<{ tickets: any[]; pagination: any }>(`/admin/tickets?${query.toString()}`);
  }

  // Admin - Problem Lists
  async getAdminLists(params?: { page?: number; pageSize?: number }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    return this.request<{ lists: any[]; pagination: any }>(`/admin/lists?${query.toString()}`);
  }

  // Admin - SQL Execute (super admin only)
  async executeSql(query: string, password?: string) {
    return this.request<{ results?: any[]; meta?: any }>(`/admin/sql`, {
      method: 'POST',
      body: JSON.stringify({ query, password }),
    });
  }

  // SQL Visual Editor APIs
  async getSqlTables() {
    return this.request<{ tables: string[] }>('/admin/sql/tables');
  }

  async getTableSchema(tableName: string) {
    return this.request<{ schema: any[] }>(`/admin/sql/table/${tableName}/schema`);
  }

  async getTableData(tableName: string, params?: { page?: number; pageSize?: number }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    return this.request<{ rows: any[]; pagination: any }>(`/admin/sql/table/${tableName}/data?${query.toString()}`);
  }

  async insertTableRow(tableName: string, data: Record<string, any>) {
    return this.request<{ meta: any }>(`/admin/sql/table/${tableName}/row`, {
      method: 'POST',
      body: JSON.stringify({ data }),
    });
  }

  async updateTableRow(tableName: string, data: Record<string, any>, where: Record<string, any>) {
    return this.request<{ meta: any }>(`/admin/sql/table/${tableName}/row`, {
      method: 'PUT',
      body: JSON.stringify({ data, where }),
    });
  }

  async deleteTableRow(tableName: string, where: Record<string, any>, password: string) {
    return this.request<{ meta: any }>(`/admin/sql/table/${tableName}/row`, {
      method: 'DELETE',
      body: JSON.stringify({ where, password }),
    });
  }

  // Solutions
  async getSolutions(params?: { problem_id?: number; page?: number; pageSize?: number; sort?: string }) {
    const query = new URLSearchParams();
    if (params?.problem_id) query.set('problem_id', String(params.problem_id));
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    if (params?.sort) query.set('sort', params.sort);
    return this.request<{ solutions: any[]; pagination: any }>(`/solutions?${query.toString()}`);
  }

  async getSolution(id: number) {
    return this.request<{ solution: any; is_voted: boolean }>(`/solutions/${id}`);
  }

  async createSolution(data: { problem_id: number; title: string; content: string; language?: string }) {
    return this.request<{ id: number; message: string }>('/solutions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateSolution(id: number, data: { title?: string; content?: string; language?: string }) {
    return this.request<{ message: string }>(`/solutions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteSolution(id: number) {
    return this.request<{ message: string }>(`/solutions/${id}`, {
      method: 'DELETE',
    });
  }

  async voteSolution(id: number) {
    return this.request<{ vote_count: number; is_voted: boolean }>(`/solutions/${id}/vote`, {
      method: 'POST',
    });
  }

  // Discussions
  async getDiscussions(params?: { problem_id?: number; page?: number; pageSize?: number; category?: string; sort?: string }) {
    const query = new URLSearchParams();
    if (params?.problem_id) query.set('problem_id', String(params.problem_id));
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    if (params?.category) query.set('category', params.category);
    if (params?.sort) query.set('sort', params.sort);
    return this.request<{ discussions: any[]; pagination: any }>(`/discussions?${query.toString()}`);
  }

  async getDiscussion(id: number) {
    return this.request<{ discussion: any; replies: any[] }>(`/discussions/${id}`);
  }

  async createDiscussion(data: { problem_id?: number; title: string; content: string; category?: string }) {
    return this.request<{ id: number; message: string }>('/discussions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateDiscussion(id: number, data: { title?: string; content?: string; category?: string }) {
    return this.request<{ message: string }>(`/discussions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteDiscussion(id: number) {
    return this.request<{ message: string }>(`/discussions/${id}`, {
      method: 'DELETE',
    });
  }

  async createDiscussionReply(discussionId: number, content: string) {
    return this.request<{ message: string }>(`/discussions/${discussionId}/replies`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  }

  async deleteDiscussionReply(discussionId: number, replyId: number) {
    return this.request<{ message: string }>(`/discussions/${discussionId}/replies/${replyId}`, {
      method: 'DELETE',
    });
  }

  async updateProfile(data: { avatar_url?: string; bio?: string }) {
    return this.request<{ user: any }>('/users/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async changePassword(oldPassword: string, newPassword: string) {
    return this.request<{ message: string }>('/users/change-password', {
      method: 'PUT',
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
    });
  }

  // Settings
  async getSettings() {
    return this.request<Record<string, string>>('/settings');
  }

  async getSiteStats() {
    return this.request<{ problems: number; users: number; submissions: number; today_submissions: number }>('/settings/stats');
  }

  async getUserHeatmap() {
    return this.request<{ heatmap: Record<string, number> }>('/users/heatmap');
  }

  async getUserLanguageStats() {
    return this.request<{ languages: { language: string; total: number; accepted: number }[] }>('/users/language-stats');
  }

  async getSetting(key: string) {
    return this.request<{ value: string }>(`/settings/${key}`);
  }

  async updateSettings(data: Record<string, string>) {
    return this.request<{ message: string }>('/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async uploadImage(file: File) {
    const formData = new FormData();
    formData.append('file', file);
    return this.request<{ id: number; url: string; filename: string; original_name: string; file_type: string; size_bytes: number }>('/uploads/image', {
      method: 'POST',
      body: formData,
    }, true);
  }

  async uploadFile(file: File) {
    const formData = new FormData();
    formData.append('file', file);
    return this.request<{ id: number; url: string; filename: string; original_name: string; file_type: string; size_bytes: number }>('/uploads/file', {
      method: 'POST',
      body: formData,
    }, true);
  }

  async getUploads(params?: { page?: number; pageSize?: number; type?: string }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    if (params?.type) query.set('type', params.type);
    return this.request<{ uploads: any[]; pagination: any }>(`/uploads?${query.toString()}`);
  }

  async deleteUpload(id: number) {
    return this.request<{ message: string }>(`/uploads/${id}`, {
      method: 'DELETE',
    });
  }

  // AI
  async aiChat(messages: { role: string; content: string }[], context?: string, model?: string) {
    return this.request<{ content: string; model: string; provider: string; tool_calls?: { name: string; arguments: any; result_summary: string }[] }>('/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ messages, context, model }),
    });
  }

  // Streaming AI chat — returns an async generator of SSE events
  async *aiChatStream(
    messages: { role: string; content: string }[],
    context?: string,
    model?: string
  ): AsyncGenerator<{ type: string; data: any }> {
    const token = useAuthStore.getState().token;
    const url = `${API_BASE}/ai/chat`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ messages, context, model, stream: true }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: { message: 'Request failed' } }));
      throw new Error(err.error?.message || `HTTP ${response.status}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
          let eventType = '';
          let eventData: any = {};
          for (const line of part.split('\n')) {
            if (line.startsWith('event: ')) eventType = line.slice(7).trim();
            else if (line.startsWith('data: ')) {
              try { eventData = JSON.parse(line.slice(6)); } catch {}
            }
          }
          if (eventType) yield { type: eventType, data: eventData };
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async aiComplete(data: { code: string; language?: string; problem_title?: string; problem_description?: string; instruction?: string; model?: string }) {
    return this.request<{ content: string; model: string; provider: string }>('/ai/complete', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async aiStatus() {
    return this.request<{ available: boolean; chat_enabled: boolean; completion_enabled: boolean; provider: string; model: string; allowed_models: { model: string; display_name: string }[] }>('/ai/status');
  }

  async getAIModels() {
    return this.request<{ models: AIModelConfig[] }>('/ai/models');
  }

  async updateAIModels(models: AIModelConfig[]) {
    return this.request<{ models: AIModelConfig[] }>('/ai/models', {
      method: 'PUT',
      body: JSON.stringify({ models }),
    });
  }

  // ── Audit Logs ──

  async getAuditLogs(params: {
    page?: number;
    pageSize?: number;
    search?: string;
    action?: string;
    ip?: string;
  } = {}) {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    if (params.search) query.set('search', params.search);
    if (params.action) query.set('action', params.action);
    if (params.ip) query.set('ip', params.ip);
    return this.request<{
      logs: any[];
      pagination: { page: number; pageSize: number; total: number; totalPages: number };
    }>(`/audit/logs?${query.toString()}`);
  }

  // ── Banned IPs ──

  async getBannedIPs(params: { page?: number; pageSize?: number } = {}) {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    return this.request<{
      bans: any[];
      pagination: { page: number; pageSize: number; total: number; totalPages: number };
    }>(`/audit/banned-ips?${query.toString()}`);
  }

  async banIP(ip: string, reason: string = '') {
    return this.request<{ message: string }>('/audit/banned-ips', {
      method: 'POST',
      body: JSON.stringify({ ip, reason }),
    });
  }

  async unbanIP(id: number) {
    return this.request<{ message: string }>(`/audit/banned-ips/${id}`, {
      method: 'DELETE',
    });
  }

  // ── Banned Devices ──

  async getBannedDevices(params: { page?: number; pageSize?: number } = {}) {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    return this.request<{
      bans: any[];
      pagination: { page: number; pageSize: number; total: number; totalPages: number };
    }>(`/audit/banned-devices?${query.toString()}`);
  }

  async banDevice(device_fingerprint: string, reason: string = '') {
    return this.request<{ message: string }>('/audit/banned-devices', {
      method: 'POST',
      body: JSON.stringify({ device_fingerprint, reason }),
    });
  }

  async unbanDevice(id: number) {
    return this.request<{ message: string }>(`/audit/banned-devices/${id}`, {
      method: 'DELETE',
    });
  }

  // Training plans
  async getTrainingPlans(params?: { page?: number; pageSize?: number; search?: string; category?: string; difficulty?: string; official?: boolean }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    if (params?.search) query.set('search', params.search);
    if (params?.category) query.set('category', params.category);
    if (params?.difficulty) query.set('difficulty', params.difficulty);
    if (params?.official) query.set('official', '1');
    return this.request<{ plans: any[]; pagination: any }>(`/training?${query.toString()}`);
  }

  async getTrainingPlan(id: number) {
    return this.request<{ plan: any }>(`/training/${id}`);
  }

  async getTrainingProgress(id: number) {
    return this.request<{ completed: number; total: number; percent: number }>(`/training/${id}/progress`);
  }

  async joinTraining(id: number) {
    return this.request<{ message: string }>(`/training/${id}/join`, { method: 'POST' });
  }

  async createTrainingPlan(data: any) {
    return this.request<{ id: number; message: string }>('/training', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateTrainingPlan(id: number, data: any) {
    return this.request<{ message: string }>(`/training/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteTrainingPlan(id: number) {
    return this.request<{ message: string }>(`/training/${id}`, { method: 'DELETE' });
  }

  async addTrainingChapter(planId: number, data: { title: string; description?: string; sort_order?: number }) {
    return this.request<{ id: number; message: string }>(`/training/${planId}/chapters`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateTrainingChapter(id: number, data: { title?: string; description?: string; sort_order?: number }) {
    return this.request<{ message: string }>(`/training/chapters/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteTrainingChapter(id: number) {
    return this.request<{ message: string }>(`/training/chapters/${id}`, { method: 'DELETE' });
  }

  async addChapterProblem(chapterId: number, data: { problem_id: number; note?: string; sort_order?: number }) {
    return this.request<{ message: string }>(`/training/chapters/${chapterId}/problems`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async removeChapterProblem(chapterId: number, problemId: number) {
    return this.request<{ message: string }>(`/training/chapters/${chapterId}/problems/${problemId}`, {
      method: 'DELETE',
    });
  }

  // Plagiarism
  async triggerPlagiarismCheck(contestId: number) {
    return this.request<{ checked: number; reports: number; message: string }>(`/admin/contests/${contestId}/plagiarism-check`, {
      method: 'POST',
    });
  }

  async getPlagiarismReports(contestId: number) {
    return this.request<{ reports: any[] }>(`/admin/contests/${contestId}/plagiarism-reports`);
  }

  async getPlagiarismReport(id: number) {
    return this.request<{ report: any; submission_a: any; submission_b: any }>(`/admin/plagiarism/${id}`);
  }

  // Notifications
  async getNotifications(params?: { page?: number; pageSize?: number; type?: string }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    if (params?.type) query.set('type', params.type);
    return this.request<{ notifications: any[]; pagination: any }>(`/notifications?${query.toString()}`);
  }

  async getUnreadNotificationsCount() {
    return this.request<{ count: number }>('/notifications/unread-count');
  }

  async markNotificationRead(id: number) {
    return this.request<{ message: string }>(`/notifications/${id}/read`, { method: 'POST' });
  }

  async markAllNotificationsRead() {
    return this.request<{ message: string }>('/notifications/read-all', { method: 'POST' });
  }

  // Follows
  async followUser(username: string) {
    return this.request<{ following: boolean; message: string }>(`/users/${username}/follow`, { method: 'POST' });
  }

  async unfollowUser(username: string) {
    return this.request<{ following: boolean; message: string }>(`/users/${username}/follow`, { method: 'DELETE' });
  }

  async getFollowers(username: string, params?: { page?: number; pageSize?: number }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    return this.request<{ users: any[]; pagination: any }>(`/users/${username}/followers?${query.toString()}`);
  }

  async getFollowing(username: string, params?: { page?: number; pageSize?: number }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    return this.request<{ users: any[]; pagination: any }>(`/users/${username}/following?${query.toString()}`);
  }

  // Messages
  async getConversations() {
    return this.request<{ conversations: any[] }>('/messages/conversations');
  }

  async getConversation(id: number, params?: { page?: number; pageSize?: number }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    return this.request<{ messages: any[]; pagination: any }>(`/messages/conversations/${id}?${query.toString()}`);
  }

  async sendMessage(targetUserId: number, content: string) {
    return this.request<{ conversation_id: number; message: string }>('/messages/conversations', {
      method: 'POST',
      body: JSON.stringify({ target_user_id: targetUserId, content }),
    });
  }

  async markConversationRead(id: number) {
    return this.request<{ message: string }>(`/messages/conversations/${id}/read`, { method: 'POST' });
  }

  async getUnreadMessagesCount() {
    return this.request<{ count: number }>('/messages/unread-count');
  }

  // Teams
  async getTeams(params?: { page?: number; pageSize?: number; search?: string }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    if (params?.search) query.set('search', params.search);
    return this.request<{ teams: any[]; pagination: any }>(`/teams?${query.toString()}`);
  }

  async getTeam(slug: string) {
    return this.request<{ team: any; members: any[] }>(`/teams/${slug}`);
  }

  async createTeam(data: { name: string; slug: string; description?: string; avatar_url?: string; is_public?: boolean }) {
    return this.request<{ id: number; message: string }>('/teams', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateTeam(id: number, data: any) {
    return this.request<{ message: string }>(`/teams/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }

  async deleteTeam(id: number) {
    return this.request<{ message: string }>(`/teams/${id}`, { method: 'DELETE' });
  }

  async joinTeam(id: number) {
    return this.request<{ message: string }>(`/teams/${id}/join`, { method: 'POST' });
  }

  async leaveTeam(id: number) {
    return this.request<{ message: string }>(`/teams/${id}/leave`, { method: 'POST' });
  }

  async removeTeamMember(teamId: number, userId: number) {
    return this.request<{ message: string }>(`/teams/${teamId}/members/${userId}`, { method: 'DELETE' });
  }

  async getTeamRankings(id: number) {
    return this.request<{ rankings: any[] }>(`/teams/${id}/rankings`);
  }

  // Blogs
  async getBlogs(params?: { page?: number; pageSize?: number; sort?: string; tag?: string }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    if (params?.sort) query.set('sort', params.sort);
    if (params?.tag) query.set('tag', params.tag);
    return this.request<{ blogs: any[]; pagination: any }>(`/blogs?${query.toString()}`);
  }

  async getBlog(id: number) {
    return this.request<{ blog: any }>(`/blogs/${id}`);
  }

  async createBlog(data: { title: string; content: string; tags?: string; status?: string }) {
    return this.request<{ id: number; message: string }>('/blogs', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateBlog(id: number, data: any) {
    return this.request<{ message: string }>(`/blogs/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }

  async deleteBlog(id: number) {
    return this.request<{ message: string }>(`/blogs/${id}`, { method: 'DELETE' });
  }

  async likeBlog(id: number) {
    return this.request<{ liked: boolean; message: string }>(`/blogs/${id}/like`, { method: 'POST' });
  }

  async getBlogLikeStatus(id: number) {
    return this.request<{ liked: boolean }>(`/blogs/${id}/like-status`);
  }

  async getBlogComments(id: number, params?: { page?: number; pageSize?: number }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    return this.request<{ comments: any[]; pagination: any }>(`/blogs/${id}/comments?${query.toString()}`);
  }

  async postBlogComment(id: number, content: string) {
    return this.request<{ id: number; message: string }>(`/blogs/${id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  }

  // Solution review
  async getPendingSolutions(params?: { page?: number; pageSize?: number; status?: string }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    if (params?.status) query.set('status', params.status);
    return this.request<{ solutions: any[]; pagination: any }>(`/solutions/admin/review?${query.toString()}`);
  }

  async approveSolution(id: number) {
    return this.request<{ message: string }>(`/solutions/admin/${id}/approve`, { method: 'POST' });
  }

  async rejectSolution(id: number, reason: string) {
    return this.request<{ message: string }>(`/solutions/admin/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  // Problem reports
  async createProblemReport(problemId: number, type: string, description: string) {
    return this.request<{ id: number; message: string }>(`/problems/${problemId}/reports`, {
      method: 'POST',
      body: JSON.stringify({ type, description }),
    });
  }

  async getProblemReports(params?: { page?: number; pageSize?: number; status?: string }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    if (params?.status) query.set('status', params.status);
    return this.request<{ reports: any[]; pagination: any }>(`/problems/admin/reports?${query.toString()}`);
  }

  async updateProblemReport(id: number, status: string, adminReply: string) {
    return this.request<{ message: string }>(`/problems/admin/reports/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ status, admin_reply: adminReply }),
    });
  }

  // === Wave C: Rating / Contest / Recommendation ===

  // Personalized problem recommendations for the current user
  async getRecommendedProblems(limit = 10) {
    return this.request<{ recommendations: any[]; user_rating: number; top_tags: string[] }>(
      `/problems/recommend?limit=${limit}`
    );
  }

  // Start a virtual participation for an ended contest
  async startVirtualParticipation(contestId: number) {
    return this.request<{ participant_id: number; virtual_start_time: string; message: string }>(
      `/contests/${contestId}/virtual-register`,
      { method: 'POST' }
    );
  }

  // Finalize ratings for a rated contest (admin)
  async finalizeContestRatings(contestId: number) {
    return this.request<{ message: string; changes_count: number; changes: any[] }>(
      `/contests/${contestId}/finalize`,
      { method: 'POST' }
    );
  }

  // Get rating changes for a finalized contest
  async getContestRatingChanges(contestId: number) {
    return this.request<{ contest: any; changes: any[] }>(`/contests/${contestId}/rating-changes`);
  }

  // ─────────────────────────────────────────────────────────────
  // Admin: Blog management
  // ─────────────────────────────────────────────────────────────
  async getAdminBlogs(params?: { page?: number; pageSize?: number; search?: string; status?: string }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    if (params?.search) query.set('search', params.search);
    if (params?.status) query.set('status', params.status);
    return this.request<{ blogs: any[]; pagination: any }>(`/admin/blogs?${query.toString()}`);
  }

  async getAdminBlog(id: number) {
    return this.request<{ blog: any }>(`/admin/blogs/${id}`);
  }

  async updateBlogStatus(id: number, status: string) {
    return this.request<{ message: string }>(`/admin/blogs/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
  }

  async deleteBlogAdmin(id: number) {
    return this.request<{ message: string }>(`/admin/blogs/${id}`, { method: 'DELETE' });
  }

  // ─────────────────────────────────────────────────────────────
  // Admin: Team management
  // ─────────────────────────────────────────────────────────────
  async getAdminTeams(params?: { page?: number; pageSize?: number; search?: string }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    if (params?.search) query.set('search', params.search);
    return this.request<{ teams: any[]; pagination: any }>(`/admin/teams?${query.toString()}`);
  }

  async deleteTeamAdmin(id: number) {
    return this.request<{ message: string }>(`/admin/teams/${id}`, { method: 'DELETE' });
  }

  async updateTeamVisibility(id: number, isPublic: boolean) {
    return this.request<{ message: string }>(`/admin/teams/${id}/visibility`, {
      method: 'PUT',
      body: JSON.stringify({ is_public: isPublic }),
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Admin: Message moderation
  // ─────────────────────────────────────────────────────────────
  async getAdminConversations(params?: { page?: number; pageSize?: number; search?: string }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    if (params?.search) query.set('search', params.search);
    return this.request<{ conversations: any[]; pagination: any }>(`/admin/messages/conversations?${query.toString()}`);
  }

  async getAdminConversationMessages(id: number, params?: { page?: number; pageSize?: number }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    return this.request<{ messages: any[]; pagination: any }>(`/admin/messages/conversations/${id}?${query.toString()}`);
  }

  async deleteMessageAdmin(id: number) {
    return this.request<{ message: string }>(`/admin/messages/${id}`, { method: 'DELETE' });
  }

  async deleteConversationAdmin(id: number) {
    return this.request<{ message: string }>(`/admin/messages/conversations/${id}`, { method: 'DELETE' });
  }
}

export const api = new ApiClient(API_BASE);
