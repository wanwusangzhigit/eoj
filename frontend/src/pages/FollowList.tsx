import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import { Users, ChevronLeft, ChevronRight } from 'lucide-react';
import { t } from '../i18n';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import './FollowList.css';

export default function FollowList() {
  const { username, type } = useParams<{ username: string; type: string }>();
  const isFollowers = type === 'followers';
  const [users, setUsers] = useState<any[]>([]);
  const [pagination, setPagination] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  useDocumentTitle(isFollowers ? t('follow.followers') : t('follow.followingList'));

  useEffect(() => {
    fetchUsers();
  }, [username, type, page]);

  const fetchUsers = async () => {
    if (!username) return;
    setLoading(true);
    try {
      const data = isFollowers
        ? await api.getFollowers(username, { page, pageSize: 20 })
        : await api.getFollowing(username, { page, pageSize: 20 });
      setUsers(data.users);
      setPagination(data.pagination);
    } catch (e) {
      console.error('Failed to fetch:', e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="follow-list-page">
      <div className="follow-list-header">
        <h1>
          <Users size={22} />
          {isFollowers ? t('follow.followers') : t('follow.followingList')} — {username}
        </h1>
        <Link to={`/users/${username}`} className="btn btn-secondary btn-sm">
          {t('follow.backToProfile')}
        </Link>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : users.length === 0 ? (
        <div className="empty-state">
          <p>{isFollowers ? t('follow.noFollowers') : t('follow.noFollowing')}</p>
        </div>
      ) : (
        <div className="follow-grid">
          {users.map((u) => (
            <Link key={u.id} to={`/users/${u.username}`} className="follow-card">
              {u.avatar_url ? (
                <img src={u.avatar_url} alt={u.username} className="follow-avatar" />
              ) : (
                <div className="follow-avatar placeholder">
                  {u.username.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="follow-info">
                <div className="follow-username">{u.username}</div>
                {u.bio && <div className="follow-bio">{u.bio}</div>}
              </div>
            </Link>
          ))}
        </div>
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className="pagination">
          <button className="btn-icon-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            <ChevronLeft size={14} />
          </button>
          <span>{t('common.page').replace('{0}', String(page)).replace('{1}', String(pagination.totalPages))}</span>
          <button className="btn-icon-sm" disabled={page >= pagination.totalPages} onClick={() => setPage(page + 1)}>
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
