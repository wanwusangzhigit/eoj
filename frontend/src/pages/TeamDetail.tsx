import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import {
  Users, UserMinus, LogOut, Trophy, ArrowLeft, Bell, MessageSquare,
  BookOpen, Swords, Shield, Check, X, Plus, Send, Star, Eye,
  Calendar, Clock, UserPlus, Settings, UserCog, Flag,
} from 'lucide-react';
import { t } from '../i18n';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useAuthStore } from '../store/auth';
import { useToastStore } from '../store/toast';
import './Teams.css';

type Tab = 'overview' | 'announcements' | 'discussions' | 'problemSets' | 'contests' | 'members' | 'rankings' | 'settings';

export default function TeamDetail() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuthStore();
  const addToast = useToastStore((s) => s.addToast);
  const [team, setTeam] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('overview');
  useDocumentTitle(team?.name || t('teams.title'));

  useEffect(() => {
    fetchTeam();
  }, [slug]);

  const fetchTeam = async () => {
    if (!slug) return;
    setLoading(true);
    try {
      const data = await api.getTeam(slug);
      setTeam(data.team);
      setMembers(data.members);
      setAnnouncements(data.announcements || []);
    } catch (e: any) {
      addToast('error', e.message || t('common.loadError'));
    } finally {
      setLoading(false);
    }
  };

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
    { key: 'problemSets', icon: BookOpen, label: t('teams.problemSets') },
    { key: 'contests', icon: Swords, label: t('teams.teamContests') },
    { key: 'members', icon: Users, label: t('teams.members') },
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

  useEffect(() => { fetchAnnouncements(); }, [teamId]);

  const fetchAnnouncements = async () => {
    setLoading(true);
    try {
      const data = await api.getTeamAnnouncements(teamId, { pageSize: 20 });
      setList(data.announcements);
    } catch { /* ignore */ }
    setLoading(false);
  };

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

  useEffect(() => { fetchDiscussions(); }, [teamId]);

  const fetchDiscussions = async () => {
    setLoading(true);
    try {
      const data = await api.getTeamDiscussions(teamId, { pageSize: 20 });
      setList(data.discussions);
    } catch { /* ignore */ }
    setLoading(false);
  };

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

// ===== Problem Sets Tab =====
function ProblemSetsTab({ teamId, isMember }: { teamId: number; isMember: boolean }) {
  const addToast = useToastStore((s) => s.addToast);
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', is_public: true });
  const [selectedSet, setSelectedSet] = useState<any>(null);
  const [addProblemId, setAddProblemId] = useState('');

  useEffect(() => { fetchSets(); }, [teamId]);

  const fetchSets = async () => {
    setLoading(true);
    try {
      const data = await api.getTeamProblemSets(teamId, { pageSize: 20 });
      setList(data.problem_sets);
    } catch { /* ignore */ }
    setLoading(false);
  };

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
                <Link to={`/problems/${p.slug}`}>{p.title}</Link>
                <span className={`diff-badge diff-${p.difficulty?.toLowerCase()}`}>{p.difficulty}</span>
                {p.solved && <span className="badge badge-success"><Check size={12} /> {t('problemList.accepted')}</span>}
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
  const [form, setForm] = useState({ title: '', description: '', start_time: '', end_time: '', scoring_type: 'acm', is_public: false });

  useEffect(() => { fetchContests(); }, [teamId]);

  const fetchContests = async () => {
    setLoading(true);
    try {
      const data = await api.getTeamContests(teamId, { pageSize: 20 });
      setList(data.contests);
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.start_time || !form.end_time) return;
    try {
      await api.createTeamContest(teamId, form);
      addToast('success', t('common.success'));
      setForm({ title: '', description: '', start_time: '', end_time: '', scoring_type: 'acm', is_public: false });
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
              <option value="acm">{t('teams.acmType')}</option>
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
                <span><Calendar size={12} /> {new Date(c.start_time).toLocaleDateString()}</span>
                <span><Clock size={12} /> {c.status}</span>
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
  }, [teamId]);

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
          <div key={m.user_id} className="member-row">
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
    setLoading(true);
    api.getTeamRankings(teamId).then((r) => setRankings(r.rankings)).catch(() => {}).finally(() => setLoading(false));
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