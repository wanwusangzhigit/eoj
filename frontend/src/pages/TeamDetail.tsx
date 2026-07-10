import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import { Users, UserMinus, LogOut, Trophy, ArrowLeft } from 'lucide-react';
import { t } from '../i18n';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useAuthStore } from '../store/auth';
import { useToastStore } from '../store/toast';
import './Teams.css';

export default function TeamDetail() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuthStore();
  const addToast = useToastStore((s) => s.addToast);
  const [team, setTeam] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [rankings, setRankings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'members' | 'rankings'>('members');
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
      const r = await api.getTeamRankings(data.team.id);
      setRankings(r.rankings);
    } catch (e: any) {
      addToast('error', e.message || t('common.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!team) return;
    try {
      await api.joinTeam(team.id);
      addToast('success', t('teams.joinedTeam'));
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
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin' || user?.id === 1;

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
          </div>
          {user && (
            <div className="team-actions">
              {isMember ? (
                isOwner ? (
                  <span className="badge owner-badge">{t('teams.owner')}</span>
                ) : (
                  <button className="btn btn-secondary btn-sm" onClick={handleLeave}>
                    <LogOut size={14} />
                    {t('teams.leaveTeam')}
                  </button>
                )
              ) : (
                <button className="btn btn-primary btn-sm" onClick={handleJoin}>
                  <Users size={14} />
                  {t('teams.joinTeam')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="team-tabs">
        <button
          className={`team-tab ${tab === 'members' ? 'active' : ''}`}
          onClick={() => setTab('members')}
        >
          <Users size={14} />
          {t('teams.members')}
        </button>
        <button
          className={`team-tab ${tab === 'rankings' ? 'active' : ''}`}
          onClick={() => setTab('rankings')}
        >
          <Trophy size={14} />
          {t('teams.teamRankings')}
        </button>
      </div>

      {tab === 'members' ? (
        <div className="members-list">
          {members.map((m, idx) => (
            <div key={m.user_id} className="member-row">
              <span className="rank">{idx + 1}</span>
              {m.avatar_url ? (
                <img src={m.avatar_url} alt={m.username} className="member-avatar" />
              ) : (
                <div className="member-avatar placeholder">
                  {m.username.charAt(0).toUpperCase()}
                </div>
              )}
              <Link to={`/users/${m.username}`} className="member-name">{m.username}</Link>
              <span className={`member-role ${m.role}`}>{t(`teams.${m.role}`)}</span>
              <span className="member-stats">
                {t('teams.solvedCount')}: {m.accepted_count || 0}
              </span>
              {(isOwner || isAdmin) && m.role !== 'owner' && (
                <button className="btn-icon-sm danger" onClick={() => handleRemoveMember(m.user_id)} title={t('teams.removeMember')}>
                  <UserMinus size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="rankings-list">
          {rankings.map((r, idx) => (
            <div key={r.user_id} className="member-row">
              <span className="rank">{idx + 1}</span>
              {r.avatar_url ? (
                <img src={r.avatar_url} alt={r.username} className="member-avatar" />
              ) : (
                <div className="member-avatar placeholder">
                  {r.username.charAt(0).toUpperCase()}
                </div>
              )}
              <Link to={`/users/${r.username}`} className="member-name">{r.username}</Link>
              <span className="member-stats">
                {t('teams.solvedCount')}: {r.solved_count || 0}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
