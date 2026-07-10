import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import { Users, Search, Plus } from 'lucide-react';
import { t } from '../i18n';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useAuthStore } from '../store/auth';
import './Teams.css';

export default function Teams() {
  const [teams, setTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const { user } = useAuthStore();
  useDocumentTitle(t('teams.title'));

  useEffect(() => {
    fetchTeams();
  }, [search]);

  const fetchTeams = async () => {
    setLoading(true);
    try {
      const data = await api.getTeams({ search: search || undefined, pageSize: 30 });
      setTeams(data.teams);
    } catch (e) {
      console.error('Failed to fetch teams:', e);
    } finally {
      setLoading(false);
    }
  };

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
            <Link key={team.id} to={`/teams/${team.slug}`} className="team-card">
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
