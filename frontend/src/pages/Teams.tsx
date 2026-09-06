import { useEffect, useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import { Users, Search, Plus } from 'lucide-react';
import { t } from '../i18n';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useAuthStore } from '../store/auth';
import { useSSRPage } from '../ssr/useSSRPage';
import './Teams.css';

// SSR 注入数据(对应 backend/src/loaders.ts 中 teams loader 的返回:直接是 /teams 接口结果)
interface TeamsSSRData {
  teams: any[];
  pagination: any;
}

export default function Teams() {
  const ssr = useSSRPage<TeamsSSRData>('teams');
  const firstRunRef = useRef<boolean>(true);
  const [teams, setTeams] = useState<any[]>(ssr?.teams ?? []);
  const [loading, setLoading] = useState(!ssr);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const { user } = useAuthStore();
  useDocumentTitle(t('teams.title'));

  const fetchTeams = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getTeams({ search: search || undefined, pageSize: 30 });
      setTeams(data.teams);
    } catch (e) {
      console.error('Failed to fetch teams:', e);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    // SSR 已注入数据则跳过首次拉取(避免重复请求与首屏闪烁)
    if (ssr && firstRunRef.current) {
      firstRunRef.current = false;
      return;
    }
    firstRunRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTeams();
  }, [fetchTeams, ssr]);

  return (
    <div className="teams-page">
      <div className="teams-header">
        <h1>
          <Users size={24} />
          {t('teams.title')}
        </h1>
        <div className="teams-actions">
          <form className="search-bar" onSubmit={(e) => { e.preventDefault(); setSearch(searchInput); }}>
            <Search size={16} />
            <input
              type="text"
              placeholder={t('teams.searchTeams')}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </form>
          {user && (
            <Link to="/teams/new" className="btn btn-primary btn-sm">
              <Plus size={14} />
              {t('teams.createTeam')}
            </Link>
          )}
        </div>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : teams.length === 0 ? (
        <div className="empty-state">
          <Users size={48} />
          <p>{t('teams.noTeams')}</p>
        </div>
      ) : (
        <div className="teams-grid">
          {teams.map((team) => (
            <Link key={team.id} to={`/team/${team.id}`} className="team-card">
              {team.avatar_url ? (
                <img src={team.avatar_url} alt={team.name} className="team-avatar" />
              ) : (
                <div className="team-avatar placeholder">
                  <Users size={28} />
                </div>
              )}
              <div className="team-info">
                <h3>{team.name}</h3>
                <p className="team-desc">{team.description || ''}</p>
                <div className="team-meta">
                  <span>{t('teams.memberCount')}: {team.member_count}</span>
                  <span>· {team.owner_name}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
