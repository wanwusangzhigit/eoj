import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import {
  Users, UserMinus, LogOut, Trophy, ArrowLeft, Bell, MessageSquare,
  BookOpen, Swords, Shield, Check, X, Plus, Send, Star, Eye,
  Calendar, Clock, UserPlus, Settings, UserCog, Flag,
  List, FolderOpen, Trash2, Code2, Save, Upload, Download,
  ChevronUp, ChevronDown, FileArchive, Inbox, FileCheck, FileText, Gauge, AlertCircle,
  CheckSquare, Copy, Pencil,
} from 'lucide-react';
import JSZip from 'jszip';
import { t } from '../i18n';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useAuthStore } from '../store/auth';
import { useToastStore } from '../store/toast';
import { useSettingsStore } from '../store/settings';
import { formatContestTime } from '../utils/contestTime';
import { distributeScores } from '../utils/testcaseScore';
import { useSSRPage } from '../ssr/useSSRPage';
import './Teams.css';

type Tab = 'overview' | 'announcements' | 'discussions' | 'problemSets' | 'contests' | 'members' | 'rankings' | 'settings' | 'problems' | 'groups';

// SSR 注入数据(对应 backend/src/loaders.ts 中 teamDetail loader 的返回)
interface TeamDetailSSRData {
  team?: { team?: any };
  members?: { members?: any[] };
  problemSets?: { problemSets?: any[] };
  contests?: { contests?: any[] };
}

export default function TeamDetail() {
  const { teamId } = useParams<{ teamId: string }>();
  const { user } = useAuthStore();
  const addToast = useToastStore((s) => s.addToast);
  const ssr = useSSRPage<TeamDetailSSRData>('teamDetail');
  const firstRunRef = useRef<boolean>(true);
  const [team, setTeam] = useState<any>(ssr?.team?.team ?? null);
  const [members, setMembers] = useState<any[]>(ssr?.members?.members ?? []);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [loading, setLoading] = useState(!ssr);
  const [tab, setTab] = useState<Tab>('overview');
  useDocumentTitle(team?.name || t('teams.title'));

  const fetchTeam = useCallback(async () => {
    if (!teamId) return;
    setLoading(true);
    try {
      const data = await api.getTeam(teamId);
      setTeam(data.team);
      setMembers(data.members);
      setAnnouncements(data.announcements || []);
    } catch (e: any) {
      addToast('error', e.message || t('common.loadError'));
    } finally {
      setLoading(false);
    }
  }, [teamId, addToast]);

  useEffect(() => {
    // SSR 已注入数据则跳过首次拉取(避免重复请求与首屏闪烁)
    if (ssr && firstRunRef.current) {
      firstRunRef.current = false;
      return;
    }
    firstRunRef.current = false;
    const load = async () => { fetchTeam(); };
    load();
  }, [fetchTeam, ssr]);

  const handleJoin = async () => {
    if (!team) return;
    try {
      const data = await api.joinTeam(team.id);
      addToast('success', data.message || t('teams.joinedTeam'));
      await fetchTeam();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const handleLeave = async () => {
    if (!team) return;
    if (!window.confirm(t('teams.leaveTeam') + '?')) return;
    try {
      await api.leaveTeam(team.id);
      addToast('success', t('teams.leftTeam'));
      await fetchTeam();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const handleRemoveMember = async (userId: number) => {
    if (!team) return;
    if (!window.confirm(t('teams.removeMember') + '?')) return;
    try {
      await api.removeTeamMember(team.id, userId);
      addToast('success', t('teams.removeMember'));
      await fetchTeam();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  if (loading) return <LoadingSpinner />;
  if (!team) return <div className="empty-state">{t('teams.noTeams')}</div>;

  const isMember = members.some((m) => m.user_id === user?.id);
  const isOwner = team.owner_id === user?.id;
  const isSiteAdmin = user?.role === 'admin' || user?.role === 'super_admin' || user?.id === 1;
  const canManage = isOwner;
  const userRole = members.find((m) => m.user_id === user?.id)?.role;

  const tabs: { key: Tab; icon: any; label: string }[] = [
    { key: 'overview', icon: Users, label: t('teams.overview') },
    { key: 'announcements', icon: Bell, label: t('teams.announcements') },
    { key: 'discussions', icon: MessageSquare, label: t('teams.discussions') },
    { key: 'problems', icon: BookOpen, label: t('teams.problemBank') },
    { key: 'problemSets', icon: List, label: t('teams.problemSets') },
    { key: 'contests', icon: Swords, label: t('teams.teamContests') },
    { key: 'members', icon: Users, label: t('teams.members') },
    { key: 'groups', icon: FolderOpen, label: t('teams.groupManagement') },
    { key: 'rankings', icon: Trophy, label: t('teams.teamRankings') },
    ...(canManage ? [{ key: 'settings' as Tab, icon: Settings, label: t('teams.teamSettings') }] : []),
  ];

  return (
    <div className="team-detail-page">
      <Link to="/teams" className="back-link">
        <ArrowLeft size={16} />
        {t('teams.backToTeams')}
      </Link>

      <div className="team-detail-header">
        <div className="team-avatar-wrapper">
          {team.avatar_url ? (
            <img src={team.avatar_url} alt={team.name} className="team-avatar lg" />
          ) : (
            <div className="team-avatar lg placeholder">
              <Users size={36} />
            </div>
          )}
        </div>
        <div className="team-header-info">
          <h1>{team.name}</h1>
          <p className="team-desc">{team.description}</p>
          <div className="team-meta-row">
            <span>{t('teams.memberCount')}: {team.member_count}</span>
            <span>· {t('teams.owner')}: {team.owner_name}</span>
            <span>· {team.join_method === 'free' ? t('teams.joinMethodFree') : team.join_method === 'approval' ? t('teams.joinMethodApproval') : t('teams.joinMethodInvite')}</span>
          </div>
          {user && (
            <div className="team-actions">
              {isMember ? (
                isOwner ? (
                  <span className="badge owner-badge"><Shield size={12} /> {t('teams.owner')}</span>
                ) : (
                  <>
                    <span className="badge member-badge">{userRole === 'admin' ? t('teams.admin') : t('teams.member')}</span>
                    <button className="btn btn-secondary btn-sm" onClick={handleLeave}>
                      <LogOut size={14} />
                      {t('teams.leaveTeam')}
                    </button>
                  </>
                )
              ) : (
                <button className="btn btn-primary btn-sm" onClick={handleJoin}>
                  <UserPlus size={14} />
                  {t('teams.joinTeam')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="team-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`team-tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>

      <div className="team-tab-content">
        {tab === 'overview' && (
          <OverviewTab team={team} announcements={announcements} members={members} />
        )}
        {tab === 'announcements' && (
          <AnnouncementsTab teamId={team.id} canManage={canManage} />
        )}
        {tab === 'discussions' && (
          <DiscussionsTab teamId={team.id} isMember={isMember} />
        )}
        {tab === 'problems' && (
          <ProblemsTab teamId={team.id} isMember={isMember} />
        )}
        {tab === 'problemSets' && (
          <ProblemSetsTab teamId={team.id} isMember={isMember} />
        )}
        {tab === 'contests' && (
          <ContestsTab teamId={team.id} canManage={canManage} />
        )}
        {tab === 'members' && (
          <MembersTab
            teamId={team.id} members={members} isOwner={isOwner} isSiteAdmin={isSiteAdmin}
            onRemove={handleRemoveMember} onRefresh={fetchTeam}
          />
        )}
        {tab === 'groups' && (
          <GroupsTab teamId={team.id} members={members} canManage={canManage} onRefresh={fetchTeam} />
        )}
        {tab === 'rankings' && (
          <RankingsTab teamId={team.id} />
        )}
        {tab === 'settings' && canManage && (
          <SettingsTab team={team} onRefresh={fetchTeam} />
        )}
      </div>
    </div>
  );
}

// ===== Overview Tab =====
function OverviewTab({ team, announcements, members }: any) {
  const stats = team.stats || {};
  return (
    <div className="overview-tab">
      {announcements.length > 0 && (
        <div className="card announcement-preview">
          <h3><Bell size={16} /> {t('teams.announcements')}</h3>
          {announcements.slice(0, 3).map((a: any) => (
            <div key={a.id} className="announcement-item">
              <span className={a.is_pinned ? 'pinned' : ''}>{a.title}</span>
              <span className="date">{new Date(a.created_at).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}
      <div className="team-stats-grid">
        <div className="stat-card"><Users size={20} /><span>{members.length}</span><label>{t('teams.memberCount')}</label></div>
        <div className="stat-card"><BookOpen size={20} /><span>{stats.problem_set_count || 0}</span><label>{t('teams.problemSetCount')}</label></div>
        <div className="stat-card"><Swords size={20} /><span>{stats.contest_count || 0}</span><label>{t('teams.contestCount')}</label></div>
        <div className="stat-card"><MessageSquare size={20} /><span>{stats.discussion_count || 0}</span><label>{t('teams.discussionCount')}</label></div>
      </div>
    </div>
  );
}

// ===== Announcements Tab =====
function AnnouncementsTab({ teamId, canManage }: { teamId: number; canManage: boolean }) {
  const addToast = useToastStore((s) => s.addToast);
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', content: '', is_pinned: false });

  const fetchAnnouncements = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getTeamAnnouncements(teamId, { pageSize: 20 });
      setList(data.announcements);
    } catch { /* ignore */ }
    setLoading(false);
  }, [teamId]);

  useEffect(() => {
    const load = async () => { fetchAnnouncements(); };
    load();
  }, [fetchAnnouncements]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.content) return;
    try {
      await api.createTeamAnnouncement(teamId, form);
      addToast('success', t('teams.announcementTitle'));
      setForm({ title: '', content: '', is_pinned: false });
      setShowForm(false);
      fetchAnnouncements();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm(t('common.deleteConfirm'))) return;
    try {
      await api.deleteTeamAnnouncement(teamId, id);
      fetchAnnouncements();
    } catch { /* ignore */ }
  };

  if (loading) return <LoadingSpinner />;
  return (
    <div>
      {canManage && (
        <div className="tab-actions">
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(!showForm)}>
            <Plus size={14} /> {t('teams.createAnnouncement')}
          </button>
        </div>
      )}
      {showForm && (
        <form className="card form-card" onSubmit={handleCreate}>
          <input className="form-input" placeholder={t('teams.announcementTitle')} value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          <textarea className="form-input form-textarea" rows={4} placeholder={t('teams.announcementContent')}
            value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} required />
          <label className="checkbox-label"><input type="checkbox" checked={form.is_pinned}
            onChange={(e) => setForm({ ...form, is_pinned: e.target.checked })} /> {t('teams.pinAnnouncement')}</label>
          <div className="form-actions"><button type="submit" className="btn btn-primary">{t('common.submit')}</button></div>
        </form>
      )}
      {list.length === 0 ? <div className="empty-state"><Bell size={32} /><p>{t('teams.noAnnouncements')}</p></div> : (
        <div className="announcement-list">
          {list.map((a) => (
            <div key={a.id} className={`card announcement-card ${a.is_pinned ? 'pinned' : ''}`}>
              <div className="announcement-header">
                <h3>{a.is_pinned ? <><Star size={14} className="pinned-icon" /> </> : ''}{a.title}</h3>
                <div className="announcement-meta">
                  <span>{a.username}</span>
                  <span>{new Date(a.created_at).toLocaleDateString()}</span>
                  {canManage && <button className="btn-icon-sm danger" onClick={() => handleDelete(a.id)}><X size={13} /></button>}
                </div>
              </div>
              <div className="announcement-body">{a.content}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===== Discussions Tab =====
function DiscussionsTab({ teamId, isMember }: { teamId: number; isMember: boolean }) {
  const addToast = useToastStore((s) => s.addToast);
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', content: '' });
  const [selectedDisc, setSelectedDisc] = useState<any>(null);
  const [replyContent, setReplyContent] = useState('');

  const fetchDiscussions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getTeamDiscussions(teamId, { pageSize: 20 });
      setList(data.discussions);
    } catch { /* ignore */ }
    setLoading(false);
  }, [teamId]);

  useEffect(() => {
    const load = async () => { fetchDiscussions(); };
    load();
  }, [fetchDiscussions]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.content) return;
    try {
      await api.createTeamDiscussion(teamId, form);
      addToast('success', t('common.success'));
      setForm({ title: '', content: '' });
      setShowForm(false);
      fetchDiscussions();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const handleViewDiscussion = async (discussionId: number) => {
    try {
      const data = await api.getTeamDiscussion(teamId, discussionId);
      setSelectedDisc(data);
    } catch { /* ignore */ }
  };

  const handleReply = async () => {
    if (!selectedDisc || !replyContent.trim()) return;
    try {
      await api.replyTeamDiscussion(teamId, selectedDisc.discussion.id, replyContent);
      setReplyContent('');
      handleViewDiscussion(selectedDisc.discussion.id);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  if (selectedDisc) {
    return (
      <div>
        <button className="btn btn-secondary btn-sm" onClick={() => setSelectedDisc(null)}>
          <ArrowLeft size={14} /> {t('common.back')}
        </button>
        <div className="card" style={{ marginTop: 12, padding: 16 }}>
          <h3>{selectedDisc.discussion.title}</h3>
          <div className="disc-meta"><span>{selectedDisc.discussion.username}</span><span>{new Date(selectedDisc.discussion.created_at).toLocaleString()}</span></div>
          <div className="disc-content">{selectedDisc.discussion.content}</div>
        </div>
        <div className="replies-section">
          <h4>{t('teams.reply')} ({selectedDisc.replies.length})</h4>
          {selectedDisc.replies.map((r: any) => (
            <div key={r.id} className="card reply-card">
              <span className="reply-author">{r.username}</span>
              <span className="reply-time">{new Date(r.created_at).toLocaleString()}</span>
              <div className="reply-content">{r.content}</div>
            </div>
          ))}
          {isMember && (
            <div className="reply-form">
              <textarea className="form-input form-textarea" value={replyContent} onChange={(e) => setReplyContent(e.target.value)} placeholder={t('discussions.replyPlaceholder')} />
              <button className="btn btn-primary btn-sm" onClick={handleReply}><Send size={14} /> {t('teams.reply')}</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (loading) return <LoadingSpinner />;
  return (
    <div>
      {isMember && (
        <div className="tab-actions">
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(!showForm)}>
            <Plus size={14} /> {t('teams.createDiscussion')}
          </button>
        </div>
      )}
      {showForm && (
        <form className="card form-card" onSubmit={handleCreate}>
          <input className="form-input" placeholder={t('teams.discussionTitle')} value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          <textarea className="form-input form-textarea" rows={4} placeholder={t('teams.discussionContent')}
            value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} required />
          <div className="form-actions"><button type="submit" className="btn btn-primary">{t('common.submit')}</button></div>
        </form>
      )}
      {list.length === 0 ? <div className="empty-state"><MessageSquare size={32} /><p>{t('teams.noDiscussions')}</p></div> : (
        <div className="disc-list">
          {list.map((d) => (
            <div key={d.id} className="card disc-item" onClick={() => handleViewDiscussion(d.id)}>
              <div className="disc-item-header">
                <h4>{d.is_pinned ? <><Star size={12} /> </> : ''}{d.title}</h4>
                <span className="disc-stats"><MessageSquare size={12} /> {d.reply_count} <Eye size={12} /> {d.view_count}</span>
              </div>
              <div className="disc-item-meta"><span>{d.username}</span><span>{new Date(d.created_at).toLocaleString()}</span></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===== Problems Tab (团队私有题库) =====
function ProblemsTab({ teamId, isMember }: { teamId: number; isMember: boolean }) {
  const addToast = useToastStore((s) => s.addToast);
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>({
    title: '', slug: '', description: '', input_format: '', output_format: '',
    time_limit: 1000, memory_limit: 256, tags: '', difficulty: 'Easy',
  });

  // ── 测试数据管理状态(类比主题库 AdminTestcases) ──
  const [selectedProblem, setSelectedProblem] = useState<any>(null);
  const [existingTestcases, setExistingTestcases] = useState<any[]>([]);
  const [newTestcases, setNewTestcases] = useState<any[]>([{ input: '', expected_output: '', is_sample: false, score: 10 }]);
  const [expandedTestcases, setExpandedTestcases] = useState<Set<number>>(new Set());
  const [selectedTestcases, setSelectedTestcases] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [tcLoading, setTcLoading] = useState(false);

  // 站点配置中的团队限制(每题测试数据总量上限)
  const siteSettings = useSettingsStore((s) => s.settings);
  const maxTotalTestcaseSize = parseInt(siteSettings.team_max_total_testcase_size || '') || 5 * 1024 * 1024;
  const existingTotalSize = existingTestcases.reduce(
    (sum: number, tc: any) => sum + new TextEncoder().encode(String(tc.input || '')).length + new TextEncoder().encode(String(tc.expected_output || '')).length,
    0
  );
  // 新增表单容量联动:实时汇总新行大小,预测保存后总量
  const newRowsTotalSize = newTestcases.reduce(
    (sum: number, tc: any) => sum + new TextEncoder().encode(String(tc.input || '')).length + new TextEncoder().encode(String(tc.expected_output || '')).length,
    0
  );
  const predictedTotalSize = existingTotalSize + newRowsTotalSize;
  const overTotalLimit = predictedTotalSize > maxTotalTestcaseSize;
  const formatBytes = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)}MB` : `${(bytes / 1024).toFixed(1)}KB`;

  const fetchProblems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getTeamProblems(teamId, { pageSize: 50 });
      setList(data.problems || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [teamId]);

  useEffect(() => {
    fetchProblems();
  }, [fetchProblems]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.description) {
      addToast('error', t('admin.titleRequired'));
      return;
    }
    try {
      await api.createTeamProblem(teamId, {
        title: form.title, slug: form.slug.trim(), description: form.description,
        input_format: form.input_format, output_format: form.output_format,
        time_limit: form.time_limit, memory_limit: form.memory_limit,
        tags: form.tags ? form.tags.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
        difficulty: form.difficulty,
      });
      addToast('success', t('teams.problemCreated'));
      setForm({ title: '', slug: '', description: '', input_format: '', output_format: '', time_limit: 1000, memory_limit: 256, tags: '', difficulty: 'Easy' });
      setShowForm(false);
      fetchProblems();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const handleDelete = async (problemId: number) => {
    if (!window.confirm(t('teams.confirmDeleteProblem'))) return;
    try {
      await api.deleteTeamProblem(teamId, problemId);
      addToast('success', t('teams.problemDeleted'));
      fetchProblems();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  // ── 测试数据管理 handlers ──
  const openTestcases = async (p: any) => {
    setSelectedProblem(p);
    setTcLoading(true);
    setNewTestcases([{ input: '', expected_output: '', is_sample: false, score: 10 }]);
    setExpandedTestcases(new Set());
    try {
      const data = await api.getTeamProblemTestcases(teamId, p.id);
      setExistingTestcases(data.testcases || []);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
      setExistingTestcases([]);
    } finally {
      setTcLoading(false);
    }
  };

  const handleAddTestcaseRow = () => {
    setNewTestcases([...newTestcases, { input: '', expected_output: '', is_sample: false, score: 10 }]);
  };

  const removeTestcaseRow = (index: number) => {
    if (newTestcases.length <= 1) return; // 至少保留一行
    setNewTestcases(newTestcases.filter((_, i) => i !== index));
  };

  const duplicateTestcaseRow = (index: number) => {
    const row = newTestcases[index];
    setNewTestcases([...newTestcases, { ...row }]);
  };

  // ── 拖拽上传状态 ──
  const [dragActive, setDragActive] = useState(false);
  const dropzoneFileInputRef = useRef<HTMLInputElement | null>(null);
  // ── 导入预览确认 ──
  const [importPreview, setImportPreview] = useState<{ fileName: string; parsed: any[] } | null>(null);

  const showImportPreview = (fileName: string, parsed: any[]) => {
    if (parsed.length === 0) {
      addToast('error', t('admin.atLeastOneTestcase'));
      return;
    }
    // 上传数据时按 100 分总分均匀分配(样例为 0 分)
    setImportPreview({ fileName, parsed: distributeScores(parsed) });
  };

  const confirmImportPreview = () => {
    if (!importPreview) return;
    setNewTestcases(importPreview.parsed);
    setImportPreview(null);
    addToast('success', t('admin.testcaseAdded'));
  };

  const cancelImportPreview = () => setImportPreview(null);

  const importJsonFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        const batch = Array.isArray(data) ? data : [data];
        const parsed = batch.map((item: any) => ({
          input: item.input || '',
          expected_output: item.expected_output || item.output || '',
          is_sample: item.is_sample || false,
          score: item.score || 10,
        }));
        showImportPreview(file.name, parsed);
      } catch {
        addToast('error', t('teams.testcasesHint'));
      }
    };
    reader.readAsText(file);
  };

  const importZipFile = async (file: File) => {
    try {
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const inEntries = Object.entries(zip.files).filter(
        ([name, entry]) => !entry.dir && /\.in$/i.test(name)
      );
      const parsed: any[] = [];
      for (const [name, entry] of inEntries) {
        const base = name.replace(/\.in$/i, '');
        // 允许导入 .out / .ans 任一扩展名的输出文件
        const outEntry = zip.files[`${base}.out`] || zip.files[`${base}.ans`];
        if (!outEntry || outEntry.dir) continue;
        const input = await entry.async('string');
        const output = await outEntry.async('string');
        parsed.push({ input, expected_output: output, is_sample: false, score: 10 });
      }
      showImportPreview(file.name, parsed);
    } catch {
      addToast('error', t('teams.testcasesHint'));
    }
  };

  const handleBatchUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    importJsonFile(file);
    e.target.value = '';
  };

  const handleZipImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await importZipFile(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (/\.(json)$/i.test(file.name)) {
      importJsonFile(file);
    } else if (/\.(zip)$/i.test(file.name)) {
      importZipFile(file);
    } else {
      addToast('error', t('teams.testcasesHint'));
    }
  };

  const handleSaveTestcases = async () => {
    if (!selectedProblem) return;
    const validTestcases = newTestcases.filter((tc) => tc.input && tc.expected_output);
    if (validTestcases.length === 0) {
      addToast('error', t('admin.atLeastOneTestcase'));
      return;
    }
    // 校验:新增测试点全为隐藏(无样例)时给出提示(不阻断保存)
    if (!validTestcases.some((tc) => tc.is_sample) && !existingTestcases.some((tc: any) => tc.is_sample)) {
      addToast('info', t('teams.noSampleWarning'));
    }
    setSaving(true);
    try {
      await api.addTeamProblemTestcases(teamId, selectedProblem.id, validTestcases);
      addToast('success', t('admin.testcaseAdded'));
      setNewTestcases([{ input: '', expected_output: '', is_sample: false, score: 10 }]);
      const data = await api.getTeamProblemTestcases(teamId, selectedProblem.id);
      setExistingTestcases(data.testcases);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTestcase = async (index: number) => {
    if (!selectedProblem) return;
    if (!window.confirm(t('admin.deleteTestcaseConfirm'))) return;
    try {
      await api.deleteTeamProblemTestcase(teamId, selectedProblem.id, index);
      addToast('success', t('admin.testcaseDeleted'));
      const data = await api.getTeamProblemTestcases(teamId, selectedProblem.id);
      setExistingTestcases(data.testcases);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const handleBatchExport = () => {
    if (existingTestcases.length === 0) {
      addToast('error', t('admin.noTestcaseData'));
      return;
    }
    const exportData = existingTestcases.map((tc: any) => ({
      input: tc.input,
      expected_output: tc.expected_output,
      is_sample: !!tc.is_sample,
      score: tc.score || 10,
    }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedProblem?.slug || 'testcases'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addToast('success', t('admin.exportComplete'));
  };

  const toggleTestcaseExpand = (index: number) => {
    setExpandedTestcases(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  // ── 多选 + 批量删除 ──
  const toggleSelectTestcase = (index: number) => {
    setSelectedTestcases(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedTestcases(prev =>
      prev.size === existingTestcases.length
        ? new Set()
        : new Set(existingTestcases.map((_, idx) => idx))
    );
  };

  const handleBatchDeleteTestcases = async () => {
    if (!selectedProblem || selectedTestcases.size === 0) return;
    if (!window.confirm(t('admin.deleteTestcaseConfirm'))) return;
    setSaving(true);
    try {
      // 从大到小删除,避免索引偏移
      const idxs = [...selectedTestcases].sort((a, b) => b - a);
      for (const idx of idxs) {
        await api.deleteTeamProblemTestcase(teamId, selectedProblem.id, idx);
      }
      setSelectedTestcases(new Set());
      setExpandedTestcases(new Set());
      addToast('success', t('admin.testcaseDeleted'));
      const data = await api.getTeamProblemTestcases(teamId, selectedProblem.id);
      setExistingTestcases(data.testcases);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  // ── 批量设为样例 / 取消样例 ──
  const handleBatchSetSample = async (sample: boolean) => {
    if (!selectedProblem || selectedTestcases.size === 0 || saving) return;
    setSaving(true);
    try {
      const next = existingTestcases.map((tc: any, idx: number) =>
        selectedTestcases.has(idx) ? { ...tc, is_sample: sample } : tc
      );
      await api.updateTeamProblemTestcases(teamId, selectedProblem.id, next);
      setSelectedTestcases(new Set());
      setExpandedTestcases(new Set());
      addToast('success', t('admin.testcaseAdded'));
      const data = await api.getTeamProblemTestcases(teamId, selectedProblem.id);
      setExistingTestcases(data.testcases);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  // ── 测试点排序(上移/下移,全量替换保存) ──
  const moveTestcase = async (index: number, dir: -1 | 1) => {
    if (!selectedProblem) return;
    const target = index + dir;
    if (target < 0 || target >= existingTestcases.length || saving) return;
    setSaving(true);
    try {
      const next = [...existingTestcases];
      [next[index], next[target]] = [next[target], next[index]];
      await api.updateTeamProblemTestcases(teamId, selectedProblem.id, next);
      setExpandedTestcases(new Set());
      setSelectedTestcases(new Set());
      addToast('success', t('admin.testcaseAdded'));
      const data = await api.getTeamProblemTestcases(teamId, selectedProblem.id);
      setExistingTestcases(data.testcases);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  // ── 拖拽排序 ──
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    if (saving) return;
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(index)); } catch { /* ignore */ }
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex === null) return;
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };

  const handleDragDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    const from = dragIndex;
    setDragIndex(null);
    setDragOverIndex(null);
    if (from === null || from === index || saving || !selectedProblem) return;
    setSaving(true);
    try {
      const next = [...existingTestcases];
      const [moved] = next.splice(from, 1);
      next.splice(index, 0, moved);
      // 更新原索引可能引发的展开/选中错位:清空
      setExpandedTestcases(new Set());
      setSelectedTestcases(new Set());
      api.updateTeamProblemTestcases(teamId, selectedProblem.id, next)
        .then(() => {
          addToast('success', t('admin.testcaseAdded'));
          return api.getTeamProblemTestcases(teamId, selectedProblem.id);
        })
        .then((data) => setExistingTestcases(data.testcases))
        .catch((err: any) => addToast('error', err.message || t('common.error')))
        .finally(() => setSaving(false));
    } catch (err: any) {
      addToast('error', err.message || t('common.error'));
      setSaving(false);
    }
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  // ── 测试点就地编辑 ──
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editingDraft, setEditingDraft] = useState<any>(null);

  const startEditTestcase = (index: number) => {
    if (saving) return;
    setEditingIdx(index);
    setEditingDraft({ ...existingTestcases[index] });
  };

  const cancelEditTestcase = () => {
    setEditingIdx(null);
    setEditingDraft(null);
  };

  const saveEditTestcase = async () => {
    if (!selectedProblem || editingIdx === null || !editingDraft) return;
    const draft = editingDraft;
    if (!draft.input || !draft.expected_output) {
      addToast('error', t('admin.atLeastOneTestcase'));
      return;
    }
    setSaving(true);
    try {
      const next = [...existingTestcases];
      next[editingIdx] = {
        input: draft.input,
        expected_output: draft.expected_output,
        is_sample: !!draft.is_sample,
        score: parseInt(draft.score) || 10,
      };
      await api.updateTeamProblemTestcases(teamId, selectedProblem.id, next);
      setEditingIdx(null);
      setEditingDraft(null);
      addToast('success', t('admin.testcaseAdded'));
      const data = await api.getTeamProblemTestcases(teamId, selectedProblem.id);
      setExistingTestcases(data.testcases);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  // 测试数据管理视图
  if (selectedProblem) {
    return (
      <div className="team-testcase-panel">
        <div className="tab-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => setSelectedProblem(null)}>
            <ArrowLeft size={14} /> {t('common.back')}
          </button>
          <span className="badge" style={{ marginLeft: 8 }}>{selectedProblem.title}</span>
        </div>

        <div className="testcase-existing" style={{ marginTop: 12 }}>
          <h3><FileArchive size={16} style={{ color: 'var(--primary)' }} /> {t('admin.existingTestcases')} ({existingTestcases.length})</h3>
          {tcLoading ? <LoadingSpinner /> : existingTestcases.length === 0 ? (
            <p className="testcase-empty">
              <Inbox size={36} />
              {t('admin.noTestcaseData')}
              <small>{t('teams.testcaseEmptyHint')}</small>
            </p>
          ) : (
            <>
              <div className="testcase-stats">
                <span><FileCheck size={13} /> {t('admin.sampleCount').replace('{0}', String(existingTestcases.filter((tc: any) => tc.is_sample).length))}</span>
                <span><FileText size={13} /> {t('admin.hiddenCount').replace('{0}', String(existingTestcases.filter((tc: any) => !tc.is_sample).length))}</span>
                <span><Gauge size={13} /> {t('admin.totalScore').replace('{0}', String(existingTestcases.reduce((sum: number, tc: any) => sum + (tc.score || 0), 0)))}</span>
                <span style={{ color: existingTotalSize > maxTotalTestcaseSize ? 'var(--error)' : undefined }}>
                  {t('teams.totalTestcaseSize').replace('{0}', formatBytes(existingTotalSize)).replace('{1}', formatBytes(maxTotalTestcaseSize))}
                </span>
                <button className="btn btn-secondary btn-sm" onClick={toggleSelectAll}>
                  <CheckSquare size={13} /> {selectedTestcases.size === existingTestcases.length ? t('admin.clearSelection') : t('admin.selectAll')}
                </button>
                <button className="btn btn-secondary btn-sm" onClick={handleBatchExport}>
                  <Download size={14} /> {t('admin.exportProblems')}
                </button>
                {selectedTestcases.size > 0 && (
                  <>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleBatchSetSample(true)} disabled={saving}>
                      <FileCheck size={13} /> {t('admin.setSample')}
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleBatchSetSample(false)} disabled={saving}>
                      <FileText size={13} /> {t('admin.setHidden')}
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={handleBatchDeleteTestcases} disabled={saving}>
                      <Trash2 size={13} /> {t('admin.deleteSelected').replace('{0}', String(selectedTestcases.size))}
                    </button>
                  </>
                )}
              </div>
              <div className="testcase-capacity">
                <div className="testcase-capacity-track">
                  <div
                    className={`testcase-capacity-fill ${existingTotalSize > maxTotalTestcaseSize ? 'over' : ''}`}
                    style={{ width: `${Math.min(100, (existingTotalSize / Math.max(1, maxTotalTestcaseSize)) * 100)}%` }}
                  />
                </div>
                <span className={`testcase-capacity-label ${existingTotalSize > maxTotalTestcaseSize ? 'over' : ''}`}>
                  {existingTotalSize > maxTotalTestcaseSize
                    ? t('teams.totalTestcaseOver')
                    : Math.round((existingTotalSize / Math.max(1, maxTotalTestcaseSize)) * 100) + '%'}
                </span>
              </div>
              <div className="testcase-list">
                {existingTestcases.map((tc: any, idx: number) => (
                  <div
                    key={idx}
                    className={`testcase-item${selectedTestcases.has(idx) ? ' selected' : ''}${dragIndex === idx ? ' dragging' : ''}${dragOverIndex === idx ? ' drag-over' : ''}`}
                    draggable={!saving}
                    onDragStart={(e) => handleDragStart(e, idx)}
                    onDragOver={(e) => handleDragOver(e, idx)}
                    onDrop={(e) => handleDragDrop(e, idx)}
                    onDragEnd={handleDragEnd}
                  >
                    <div className="testcase-summary-row" onClick={() => toggleTestcaseExpand(idx)}>
                      <input
                        type="checkbox"
                        className="testcase-select"
                        checked={selectedTestcases.has(idx)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleSelectTestcase(idx)}
                      />
                      <span className="testcase-index">#{idx + 1}</span>
                      <span className={`testcase-type-badge ${tc.is_sample ? 'sample' : 'hidden'}`}>
                        {tc.is_sample ? t('admin.sample') : t('admin.hidden')}
                      </span>
                      <span className="testcase-score">{t('admin.score')}: {tc.score}</span>
                      <span className="testcase-move">
                        <button
                          type="button"
                          className="btn-icon-sm"
                          disabled={idx === 0 || saving}
                          onClick={(e) => { e.stopPropagation(); moveTestcase(idx, -1); }}
                          title={t('teams.moveUp')}
                        >
                          <ChevronUp size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn-icon-sm"
                          disabled={idx === existingTestcases.length - 1 || saving}
                          onClick={(e) => { e.stopPropagation(); moveTestcase(idx, 1); }}
                          title={t('teams.moveDown')}
                        >
                          <ChevronDown size={13} />
                        </button>
                      </span>
                      <span className="testcase-expand-icon">
                        {expandedTestcases.has(idx) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </span>
                      <button
                        type="button"
                        className="btn-icon-sm"
                        disabled={saving}
                        onClick={(e) => { e.stopPropagation(); startEditTestcase(idx); }}
                        title={t('common.edit')}
                      >
                        <Pencil size={13} />
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); handleDeleteTestcase(idx); }}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                    {editingIdx === idx ? (
                      <div className="testcase-edit-form">
                        <div className="form-group">
                          <label>{t('admin.input')}</label>
                          <textarea rows={3} value={editingDraft?.input || ''} onChange={(e) => setEditingDraft({ ...editingDraft, input: e.target.value })} />
                        </div>
                        <div className="form-group">
                          <label>{t('admin.expectedOutput')}</label>
                          <textarea rows={3} value={editingDraft?.expected_output || ''} onChange={(e) => setEditingDraft({ ...editingDraft, expected_output: e.target.value })} />
                        </div>
                        <div className="form-group small">
                          <label className="checkbox-label">
                            <input type="checkbox" checked={!!editingDraft?.is_sample} onChange={(e) => setEditingDraft({ ...editingDraft, is_sample: e.target.checked })} />
                            {t('admin.sample')}
                          </label>
                        </div>
                        <div className="form-group small">
                          <label>{t('admin.score')}</label>
                          <input type="number" value={editingDraft?.score ?? 10} onChange={(e) => setEditingDraft({ ...editingDraft, score: parseInt(e.target.value) })} />
                        </div>
                        <div className="form-actions">
                          <button type="button" className="btn btn-primary btn-sm" onClick={saveEditTestcase} disabled={saving}>
                            <Save size={14} /> {saving ? t('admin.saving') : t('common.save')}
                          </button>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={cancelEditTestcase}>
                            <X size={14} /> {t('common.cancel')}
                          </button>
                        </div>
                      </div>
                    ) : expandedTestcases.has(idx) && (
                      <div className="testcase-detail">
                        <div className="testcase-item-body">
                          <div className="testcase-io">
                            <label>{t('admin.input')}:</label>
                            <pre>{tc.input}</pre>
                          </div>
                          <div className="testcase-io">
                            <label>{t('common.output')}:</label>
                            <pre>{tc.expected_output}</pre>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="testcase-new" style={{ marginTop: 16 }}>
          <h3><Upload size={16} style={{ color: 'var(--primary)' }} /> {t('admin.addNewTestcases')}</h3>
          <div
            className={`testcase-dropzone${dragActive ? ' active' : ''}`}
            onClick={() => dropzoneFileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
          >
            <Upload size={22} />
            <span>{t('teams.testcaseDropHint')}</span>
            <input
              ref={dropzoneFileInputRef}
              type="file"
              accept=".json,.zip"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  if (/\.(json)$/i.test(file.name)) importJsonFile(file);
                  else if (/\.(zip)$/i.test(file.name)) importZipFile(file);
                }
                e.target.value = '';
              }}
            />
          </div>
          {importPreview && (
            <div className="testcase-import-preview">
              <div className="testcase-import-preview-head">
                <FileCheck size={15} />
                <strong>{importPreview.fileName}</strong>
                <span>{t('teams.importPreview').replace('{0}', String(importPreview.parsed.length))}</span>
              </div>
              <div className="testcase-import-preview-stats">
                <span>{t('admin.sampleCount').replace('{0}', String(importPreview.parsed.filter((tc: any) => tc.is_sample).length))}</span>
                <span>{t('admin.hiddenCount').replace('{0}', String(importPreview.parsed.filter((tc: any) => !tc.is_sample).length))}</span>
                <span>{t('teams.totalTestcaseSize').replace('{0}', formatBytes(
                  importPreview.parsed.reduce((sum: number, tc: any) => sum + new TextEncoder().encode(String(tc.input || '')).length + new TextEncoder().encode(String(tc.expected_output || '')).length, 0)
                )).replace('{1}', formatBytes(maxTotalTestcaseSize))}</span>
              </div>
              <div className="testcase-import-preview-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={confirmImportPreview}>
                  <Check size={14} /> {t('common.confirm')}
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={cancelImportPreview}>
                  <X size={14} /> {t('common.cancel')}
                </button>
              </div>
            </div>
          )}
          {newTestcases.map((tc, idx) => {
            const rowSize = new TextEncoder().encode(String(tc.input || '')).length + new TextEncoder().encode(String(tc.expected_output || '')).length;
            return (
              <div key={idx} className="testcase-form-row">
                <div className="testcase-form-row-head">
                  <span className="testcase-form-index">#{idx + 1}</span>
                  <span className="testcase-form-size">{formatBytes(rowSize)}</span>
                  <span className="testcase-form-row-actions">
                    <button type="button" className="btn-icon-sm" onClick={() => duplicateTestcaseRow(idx)} title={t('teams.duplicateTestcase')}>
                      <Copy size={13} />
                    </button>
                    <button type="button" className="btn-icon-sm danger" onClick={() => removeTestcaseRow(idx)} title={t('common.delete')}>
                      <Trash2 size={13} />
                    </button>
                  </span>
                </div>
                <div className="form-group">
                  <label>{t('admin.input')}</label>
                  <textarea rows={3} value={tc.input} onChange={(e) => {
                    const updated = [...newTestcases];
                    updated[idx] = { ...updated[idx], input: e.target.value };
                    setNewTestcases(updated);
                  }} />
                </div>
                <div className="form-group">
                  <label>{t('admin.expectedOutput')}</label>
                  <textarea rows={3} value={tc.expected_output} onChange={(e) => {
                    const updated = [...newTestcases];
                    updated[idx] = { ...updated[idx], expected_output: e.target.value };
                    setNewTestcases(updated);
                  }} />
                </div>
                <div className="form-group small">
                  <label className="checkbox-label">
                    <input type="checkbox" checked={tc.is_sample} onChange={(e) => {
                      const updated = [...newTestcases];
                      updated[idx] = { ...updated[idx], is_sample: e.target.checked };
                      setNewTestcases(updated);
                    }} />
                    {t('admin.sample')}
                  </label>
                </div>
                <div className="form-group small">
                  <label>{t('admin.score')}</label>
                  <input type="number" value={tc.score} onChange={(e) => {
                    const updated = [...newTestcases];
                    updated[idx] = { ...updated[idx], score: parseInt(e.target.value) };
                    setNewTestcases(updated);
                  }} />
                </div>
              </div>
            );
          })}
          <div className="form-actions">
            <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
              <Upload size={14} /> {t('admin.addTestcases')}
              <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleBatchUpload} />
            </label>
            <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
              <FileArchive size={14} /> {t('admin.importProblems')}
              <input type="file" accept=".zip" style={{ display: 'none' }} onChange={handleZipImport} />
            </label>
            <button className="btn btn-secondary" onClick={handleAddTestcaseRow}>
              <Plus size={14} /> {t('admin.addTestcase')}
            </button>
            <button className="btn btn-primary" onClick={handleSaveTestcases} disabled={saving || overTotalLimit} title={overTotalLimit ? t('teams.totalTestcaseOver') : undefined}>
              <Save size={16} />
              {saving ? t('admin.saving') : t('admin.saveTestcases')}
            </button>
            {overTotalLimit && (
              <span className="testcase-over-warning">
                <AlertCircle size={14} />
                {t('teams.predictedTotal').replace('{0}', formatBytes(predictedTotalSize)).replace('{1}', formatBytes(maxTotalTestcaseSize))}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {isMember && (
        <div className="tab-actions">
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(!showForm)}>
            <Plus size={14} /> {t('teams.createProblem')}
          </button>
        </div>
      )}
      {showForm && (
        <form className="card form-card" onSubmit={handleCreate}>
          <div className="form-row">
            <label>{t('teams.problemTitle')} <input className="form-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></label>
            <label>{t('teams.problemSlug')} <input className="form-input" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} required /></label>
          </div>
          <label>{t('teams.problemDescription')} <textarea className="form-input form-textarea" rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required /></label>
          <div className="form-row">
            <label>{t('teams.inputFormat')} <textarea className="form-input form-textarea" rows={2} value={form.input_format} onChange={(e) => setForm({ ...form, input_format: e.target.value })} /></label>
            <label>{t('teams.outputFormat')} <textarea className="form-input form-textarea" rows={2} value={form.output_format} onChange={(e) => setForm({ ...form, output_format: e.target.value })} /></label>
          </div>
          <div className="form-row">
            <label>{t('teams.problemTimeLimit')} <input className="form-input" type="number" value={form.time_limit} onChange={(e) => setForm({ ...form, time_limit: parseInt(e.target.value) })} /></label>
            <label>{t('teams.problemMemoryLimit')} <input className="form-input" type="number" value={form.memory_limit} onChange={(e) => setForm({ ...form, memory_limit: parseInt(e.target.value) })} /></label>
            <label>{t('teams.problemDifficulty')}
              <select className="form-input form-select" value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}>
                <option value="Easy">Easy</option>
                <option value="Medium">Medium</option>
                <option value="Hard">Hard</option>
              </select>
            </label>
          </div>
          <label>{t('teams.problemTags')} <input className="form-input" placeholder="tag1,tag2" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></label>
          <div className="form-actions"><button type="submit" className="btn btn-primary"><Save size={14} /> {t('common.submit')}</button></div>
        </form>
      )}
      {list.length === 0 ? <div className="empty-state"><BookOpen size={32} /><p>{t('teams.noProblems')}</p></div> : (
        <div className="problem-list">
          {list.map((p) => (
            <div key={p.id} className="problem-row">
              <Link to={`/team/${teamId}/problem/${p.id}`}>{p.title}</Link>
              <span className={`diff-badge diff-${p.difficulty?.toLowerCase()}`}>{p.difficulty}</span>
              {isMember && (
                <span className="member-actions">
                  <button className="btn-icon-sm" onClick={() => openTestcases(p)} title={t('admin.manageTestcases')}><Upload size={13} /></button>
                  <Link to={`/team/${teamId}/problem/${p.id}`} className="btn-icon-sm" title={t('teams.editProblem')}><Code2 size={13} /></Link>
                  <button className="btn-icon-sm danger" onClick={() => handleDelete(p.id)} title={t('teams.deleteProblem')}><Trash2 size={13} /></button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===== Groups Tab (分组管理) =====
function GroupsTab({ teamId, members, canManage, onRefresh }: { teamId: number; members: any[]; canManage: boolean; onRefresh: () => void }) {
  const addToast = useToastStore((s) => s.addToast);
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getTeamGroups(teamId);
      setGroups(data.groups || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [teamId]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    try {
      await api.createTeamGroup(teamId, { name: name.trim() });
      addToast('success', t('teams.groupCreated'));
      setName('');
      setShowForm(false);
      fetchGroups();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const handleDelete = async (groupId: number) => {
    if (!window.confirm(t('teams.groupDeleted') + '?')) return;
    try {
      await api.deleteTeamGroup(teamId, groupId);
      addToast('success', t('teams.groupDeleted'));
      fetchGroups();
      onRefresh();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const handleAssign = async (userId: number, groupId: number | null) => {
    try {
      await api.updateTeamMemberGroup(teamId, userId, groupId);
      addToast('success', t('teams.groupAssigned'));
      onRefresh();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  if (loading) return <LoadingSpinner />;
  return (
    <div>
      {canManage && (
        <div className="tab-actions">
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(!showForm)}>
            <Plus size={14} /> {t('teams.createGroup')}
          </button>
        </div>
      )}
      {showForm && (
        <div className="card form-card">
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="form-input" placeholder={t('teams.groupName')} value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn btn-primary btn-sm" onClick={handleCreate}><Save size={14} /> {t('common.submit')}</button>
          </div>
        </div>
      )}
      <div className="groups-list">
        {groups.map((g: any) => (
          <div key={g.id} className="card" style={{ padding: 12, marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ margin: 0 }}>{g.name} <small style={{ color: 'var(--text-secondary)' }}>({g.member_count})</small></h4>
              {canManage && (
                <button className="btn-icon-sm danger" onClick={() => handleDelete(g.id)}><Trash2 size={13} /></button>
              )}
            </div>
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {members.filter((m: any) => m.group_id === g.id).map((m: any) => (
                <span key={m.user_id} className="badge">{m.username}</span>
              ))}
              {members.filter((m: any) => m.group_id === g.id).length === 0 && (
                <small style={{ color: 'var(--text-secondary)' }}>{t('teams.noGroup')}</small>
              )}
            </div>
          </div>
        ))}
        {groups.length === 0 && <div className="empty-state"><FolderOpen size={32} /><p>{t('teams.noGroups')}</p></div>}
      </div>
      {canManage && members.length > 0 && (
        <div className="card form-card" style={{ marginTop: 12 }}>
          <h4>{t('teams.assignGroup')}</h4>
          {members.filter((m: any) => m.role !== 'owner').map((m: any) => (
            <div key={m.user_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
              <span>{m.username}</span>
              <select className="form-input form-select" style={{ width: 200 }}
                value={m.group_id || ''}
                onChange={(e) => handleAssign(m.user_id, e.target.value ? parseInt(e.target.value) : null)}>
                <option value="">{t('teams.noGroup')}</option>
                {groups.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===== Problem Sets Tab =====
function ProblemSetsTab({ teamId, isMember }: { teamId: number; isMember: boolean }) {
  const addToast = useToastStore((s) => s.addToast);
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', is_public: true });
  const [selectedSet, setSelectedSet] = useState<any>(null);
  const [addProblemId, setAddProblemId] = useState('');

  const fetchSets = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getTeamProblemSets(teamId, { pageSize: 20 });
      setList(data.problem_sets);
    } catch { /* ignore */ }
    setLoading(false);
  }, [teamId]);

  useEffect(() => {
    const load = async () => { fetchSets(); };
    load();
  }, [fetchSets]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title) return;
    try {
      await api.createTeamProblemSet(teamId, form);
      addToast('success', t('common.success'));
      setForm({ title: '', description: '', is_public: true });
      setShowForm(false);
      fetchSets();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const handleViewSet = async (setId: number) => {
    try {
      const data = await api.getTeamProblemSet(teamId, setId);
      setSelectedSet(data);
    } catch { /* ignore */ }
  };

  const handleAddProblem = async () => {
    if (!addProblemId || !selectedSet) return;
    try {
      await api.addTeamProblemSetItem(teamId, selectedSet.problem_set.id, { problem_id: parseInt(addProblemId) });
      addToast('success', t('common.success'));
      setAddProblemId('');
      handleViewSet(selectedSet.problem_set.id);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const handleRemoveProblem = async (itemId: number) => {
    if (!selectedSet) return;
    if (!window.confirm(t('teams.confirmRemoveProblemFromSet'))) return;
    try {
      await api.removeTeamProblemSetItem(teamId, selectedSet.problem_set.id, itemId);
      addToast('success', t('teams.problemRemovedFromSet'));
      handleViewSet(selectedSet.problem_set.id);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  if (selectedSet) {
    return (
      <div>
        <button className="btn btn-secondary btn-sm" onClick={() => setSelectedSet(null)}>
          <ArrowLeft size={14} /> {t('common.back')}
        </button>
        <div className="card" style={{ marginTop: 12, padding: 16 }}>
          <h3>{selectedSet.problem_set.title}</h3>
          <p>{selectedSet.problem_set.description}</p>
          {isMember && (
            <div className="add-problem-form" style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <input className="form-input" style={{ width: 120 }} placeholder={t('teams.problemId')}
                value={addProblemId} onChange={(e) => setAddProblemId(e.target.value)} />
              <button className="btn btn-primary btn-sm" onClick={handleAddProblem}><Plus size={14} /> {t('teams.addProblem')}</button>
            </div>
          )}
          <div className="problem-list" style={{ marginTop: 12 }}>
            {selectedSet.problems.map((p: any) => (
              <div key={p.id} className="problem-row">
                <Link to={`/team/${teamId}/problem/${p.problem_id}`}>{p.title}</Link>
                <span className={`diff-badge diff-${p.difficulty?.toLowerCase()}`}>{p.difficulty}</span>
                {!!p.solved && <span className="badge badge-success"><Check size={12} /> {t('problemList.accepted')}</span>}
                {isMember && (
                  <button
                    className="btn-icon-sm danger"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => handleRemoveProblem(p.id)}
                    title={t('teams.removeProblem')}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (loading) return <LoadingSpinner />;
  return (
    <div>
      {isMember && (
        <div className="tab-actions">
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(!showForm)}>
            <Plus size={14} /> {t('teams.createProblemSet')}
          </button>
        </div>
      )}
      {showForm && (
        <form className="card form-card" onSubmit={handleCreate}>
          <input className="form-input" placeholder={t('teams.problemSetTitle')} value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          <textarea className="form-input form-textarea" rows={3} placeholder={t('teams.problemSetDescription')}
            value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <label className="checkbox-label"><input type="checkbox" checked={form.is_public}
            onChange={(e) => setForm({ ...form, is_public: e.target.checked })} /> {t('teams.problemSetPublic')}</label>
          <div className="form-actions"><button type="submit" className="btn btn-primary">{t('common.submit')}</button></div>
        </form>
      )}
      {list.length === 0 ? <div className="empty-state"><BookOpen size={32} /><p>{t('teams.noProblemSets')}</p></div> : (
        <div className="set-list">
          {list.map((s) => (
            <div key={s.id} className="card set-item" onClick={() => handleViewSet(s.id)}>
              <h4>{s.title}</h4>
              <p>{s.description}</p>
              <span className="set-meta">{s.problem_count} {t('problemList.titleCol')} · {s.username}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===== Contests Tab =====
function ContestsTab({ teamId, canManage }: { teamId: number; canManage: boolean }) {
  const addToast = useToastStore((s) => s.addToast);
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', start_time: '', end_time: '', scoring_type: 'icpc', is_public: false });

  const fetchContests = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getTeamContests(teamId, { pageSize: 20 });
      setList(data.contests);
    } catch { /* ignore */ }
    setLoading(false);
  }, [teamId]);

  useEffect(() => {
    const load = async () => { fetchContests(); };
    load();
  }, [fetchContests]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.start_time || !form.end_time) return;
    try {
      await api.createTeamContest(teamId, form);
      addToast('success', t('common.success'));
      setForm({ title: '', description: '', start_time: '', end_time: '', scoring_type: 'icpc', is_public: false });
      setShowForm(false);
      fetchContests();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  if (loading) return <LoadingSpinner />;
  return (
    <div>
      {canManage && (
        <div className="tab-actions">
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(!showForm)}>
            <Plus size={14} /> {t('teams.createContest')}
          </button>
        </div>
      )}
      {showForm && (
        <form className="card form-card" onSubmit={handleCreate}>
          <input className="form-input" placeholder={t('teams.contestTitle')} value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          <textarea className="form-input form-textarea" rows={3} placeholder={t('teams.contestDescription')}
            value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="form-row">
            <label>{t('teams.startTime')} <input className="form-input" type="datetime-local" value={form.start_time}
              onChange={(e) => setForm({ ...form, start_time: e.target.value })} required /></label>
            <label>{t('teams.endTime')} <input className="form-input" type="datetime-local" value={form.end_time}
              onChange={(e) => setForm({ ...form, end_time: e.target.value })} required /></label>
          </div>
          <div className="form-row">
            <select className="form-input form-select" value={form.scoring_type}
              onChange={(e) => setForm({ ...form, scoring_type: e.target.value })}>
              <option value="oi">{t('teams.oiType')}</option>
              <option value="icpc">{t('teams.icpcType')}</option>
              <option value="ioi">{t('teams.ioiType')}</option>
            </select>
            <label className="checkbox-label"><input type="checkbox" checked={form.is_public}
              onChange={(e) => setForm({ ...form, is_public: e.target.checked })} /> {t('teams.contestPublic')}</label>
          </div>
          <div className="form-actions"><button type="submit" className="btn btn-primary">{t('common.submit')}</button></div>
        </form>
      )}
      {list.length === 0 ? <div className="empty-state"><Swords size={32} /><p>{t('teams.noContests')}</p></div> : (
        <div className="contest-list">
          {list.map((c) => (
            <div key={c.id} className="card contest-item">
              <h4>{c.title}</h4>
              <div className="contest-meta">
                <span><Calendar size={12} /> {formatContestTime(c.start_time)}</span>
                <span><Clock size={12} /> {c.effective_status || c.status}</span>
                <span><Users size={12} /> {c.participant_count}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===== Members Tab =====
function MembersTab({ teamId, members, isOwner, isSiteAdmin, onRemove, onRefresh }: any) {
  const addToast = useToastStore((s) => s.addToast);
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferUserId, setTransferUserId] = useState<number | null>(null);
  const [joinRequests, setJoinRequests] = useState<any[]>([]);

  useEffect(() => {
    if (isOwner || isSiteAdmin) {
      api.getTeamJoinRequests(teamId).then((d) => setJoinRequests(d.requests)).catch(() => {});
    }
  }, [teamId, isOwner, isSiteAdmin]);

  const handleTransfer = async () => {
    if (!transferUserId) return;
    if (!window.confirm(t('teams.transferConfirm'))) return;
    try {
      await api.transferTeam(teamId, transferUserId);
      addToast('success', t('teams.transferSuccess'));
      onRefresh();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const handleApprove = async (requestId: number) => {
    try {
      await api.approveTeamJoinRequest(teamId, requestId);
      addToast('success', t('teams.joinRequestApproved'));
      onRefresh();
      const d = await api.getTeamJoinRequests(teamId);
      setJoinRequests(d.requests);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const handleReject = async (requestId: number) => {
    try {
      await api.rejectTeamJoinRequest(teamId, requestId);
      addToast('success', t('teams.joinRequestRejected'));
      const d = await api.getTeamJoinRequests(teamId);
      setJoinRequests(d.requests);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const handleRoleChange = async (targetUserId: number, role: string) => {
    try {
      await api.updateTeamMemberRole(teamId, targetUserId, role);
      addToast('success', t('teams.roleUpdated'));
      onRefresh();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const handleNoteChange = async (targetUserId: number, note: string) => {
    try {
      await api.updateTeamMemberNote(teamId, targetUserId, note);
      addToast('success', t('teams.noteSaved'));
      onRefresh();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const handlePermissionsChange = async (targetUserId: number, perm: 'can_edit_problems' | 'can_edit_contests' | 'can_edit_lists', value: boolean) => {
    try {
      await api.updateTeamMemberPermissions(teamId, targetUserId, { [perm]: value } as any);
      addToast('success', t('teams.permissionsSaved'));
      onRefresh();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  return (
    <div>
      {/* Join Requests */}
      {(isOwner || isSiteAdmin) && joinRequests.length > 0 && (
        <div className="join-requests-section">
          <h3><UserPlus size={16} /> {t('teams.joinRequestPending')} ({joinRequests.length})</h3>
          {joinRequests.map((req: any) => (
            <div key={req.id} className="card request-row">
              <Link to={`/users/${req.username}`}>{req.username}</Link>
              {req.message && <span className="req-msg">"{req.message}"</span>}
              <div className="req-actions">
                <button className="btn btn-sm btn-success" onClick={() => handleApprove(req.id)}><Check size={12} /> {t('teams.approveRequest')}</button>
                <button className="btn btn-sm btn-danger" onClick={() => handleReject(req.id)}><X size={12} /> {t('teams.rejectRequest')}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Members */}
      <div className="members-list">
        {members.map((m: any, idx: number) => (
          <div key={m.user_id} className="member-row" style={{ flexWrap: 'wrap' }}>
            <span className="rank">{idx + 1}</span>
            {m.avatar_url ? (
              <img src={m.avatar_url} alt={m.username} className="member-avatar" />
            ) : (
              <div className="member-avatar placeholder">{m.username.charAt(0).toUpperCase()}</div>
            )}
            <Link to={`/users/${m.username}`} className="member-name">{m.username}</Link>
            <span className={`member-role ${m.role}`}>
              {m.role === 'owner' ? t('teams.owner') : m.role === 'admin' ? t('teams.admin') : t('teams.member')}
            </span>
            <span className="member-stats">{t('teams.solvedCount')}: {m.accepted_count || 0}</span>
            {m.group_name && <span className="badge">{m.group_name}</span>}
            {(isOwner || isSiteAdmin) && m.role !== 'owner' && (
              <div className="member-actions">
                {isOwner && m.role !== 'admin' && (
                  <button className="btn-icon-sm" onClick={() => handleRoleChange(m.user_id, 'admin')} title={t('teams.admin')}>
                    <UserCog size={13} />
                  </button>
                )}
                {isOwner && m.role === 'admin' && (
                  <button className="btn-icon-sm" onClick={() => handleRoleChange(m.user_id, 'member')} title={t('teams.member')}>
                    <Flag size={13} />
                  </button>
                )}
                <button className="btn-icon-sm danger" onClick={() => onRemove(m.user_id)} title={t('teams.removeMember')}>
                  <UserMinus size={13} />
                </button>
              </div>
            )}
            {(isOwner || isSiteAdmin) && m.role !== 'owner' && (
              <div style={{ width: '100%', display: 'flex', gap: 12, alignItems: 'center', marginTop: 4 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {t('teams.memberNote')}:
                  <input className="form-input" style={{ width: 140 }} placeholder={t('teams.notePlaceholder')}
                    defaultValue={m.note || ''}
                    onBlur={(e) => { if (e.target.value !== (m.note || '')) handleNoteChange(m.user_id, e.target.value); }} />
                </label>
                <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {t('teams.permissions')}:
                  <label className="checkbox-label">
                    <input type="checkbox" checked={m.can_edit_problems === 1}
                      onChange={(e) => handlePermissionsChange(m.user_id, 'can_edit_problems', e.target.checked)} />
                    {t('teams.permissionProblems')}
                  </label>
                  <label className="checkbox-label">
                    <input type="checkbox" checked={m.can_edit_contests === 1}
                      onChange={(e) => handlePermissionsChange(m.user_id, 'can_edit_contests', e.target.checked)} />
                    {t('teams.permissionContests')}
                  </label>
                  <label className="checkbox-label">
                    <input type="checkbox" checked={m.can_edit_lists === 1}
                      onChange={(e) => handlePermissionsChange(m.user_id, 'can_edit_lists', e.target.checked)} />
                    {t('teams.permissionLists')}
                  </label>
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Transfer Ownership */}
      {isOwner && (
        <div className="transfer-section">
          <button className="btn btn-outline btn-sm" onClick={() => setShowTransfer(!showTransfer)}>
            <Shield size={14} /> {t('teams.transferTeam')}
          </button>
          {showTransfer && (
            <div className="transfer-form">
              <select className="form-input form-select" value={transferUserId || ''} onChange={(e) => setTransferUserId(parseInt(e.target.value))}>
                <option value="">{t('teams.transferTo')}...</option>
                {members.filter((m: any) => m.role !== 'owner').map((m: any) => (
                  <option key={m.user_id} value={m.user_id}>{m.username}</option>
                ))}
              </select>
              <button className="btn btn-danger btn-sm" onClick={handleTransfer} disabled={!transferUserId}>
                {t('teams.transferTeam')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ===== Rankings Tab =====
function RankingsTab({ teamId }: { teamId: number }) {
  const [rankings, setRankings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const r = await api.getTeamRankings(teamId);
        setRankings(r.rankings);
      } catch { /* ignore */ }
      setLoading(false);
    };
    load();
  }, [teamId]);

  if (loading) return <LoadingSpinner />;
  return (
    <div className="rankings-list">
      {rankings.length === 0 ? (
        <div className="empty-state"><Trophy size={32} /><p>{t('rankings.noSubmissionsYet')}</p></div>
      ) : (
        rankings.map((r, idx) => (
          <div key={r.user_id} className="member-row">
            <span className="rank">{idx + 1}</span>
            {r.avatar_url ? <img src={r.avatar_url} alt={r.username} className="member-avatar" /> : (
              <div className="member-avatar placeholder">{r.username.charAt(0).toUpperCase()}</div>
            )}
            <Link to={`/users/${r.username}`} className="member-name">{r.username}</Link>
            <span className="member-stats">{t('teams.solvedCount')}: {r.solved_count || 0}</span>
          </div>
        ))
      )}
    </div>
  );
}

// ===== Settings Tab =====
function SettingsTab({ team, onRefresh }: any) {
  const addToast = useToastStore((s) => s.addToast);
  const [form, setForm] = useState({
    name: team.name,
    description: team.description || '',
    avatar_url: team.avatar_url || '',
    is_public: !!team.is_public,
    join_method: team.join_method || 'free',
  });

  const handleSave = async () => {
    try {
      await api.updateTeam(team.id, form);
      addToast('success', t('teams.settingsSaved'));
      onRefresh();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(t('teams.confirmDeleteTeam'))) return;
    try {
      await api.deleteTeam(team.id);
      addToast('success', t('teams.teamDeleted'));
      window.location.href = '/teams';
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  return (
    <div className="settings-tab">
      <div className="card" style={{ padding: 16 }}>
        <h3>{t('teams.teamSettings')}</h3>
        <div className="form-group">
          <label>{t('teams.teamName')}</label>
          <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="form-group">
          <label>{t('teams.teamDescription')}</label>
          <textarea className="form-input form-textarea" rows={3} value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="form-group">
          <label>{t('teams.teamAvatar')} (URL)</label>
          <input className="form-input" value={form.avatar_url} onChange={(e) => setForm({ ...form, avatar_url: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="checkbox-label">
            <input type="checkbox" checked={form.is_public} onChange={(e) => setForm({ ...form, is_public: e.target.checked })} />
            {t('teams.isPublic')}
          </label>
        </div>
        <div className="form-group">
          <label>{t('teams.joinMethod')}</label>
          <select className="form-input form-select" value={form.join_method}
            onChange={(e) => setForm({ ...form, join_method: e.target.value })}>
            <option value="free">{t('teams.joinMethodFree')}</option>
            <option value="approval">{t('teams.joinMethodApproval')}</option>
            <option value="invite">{t('teams.joinMethodInvite')}</option>
          </select>
        </div>
        <div className="form-actions">
          <button className="btn btn-primary" onClick={handleSave}>{t('teams.saveSettings')}</button>
          <button className="btn btn-danger" onClick={handleDelete}>{t('common.delete')}</button>
        </div>
      </div>
    </div>
  );
}