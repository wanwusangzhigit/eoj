import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import AdSlot from '../components/AdSlot';
import { PenSquare, Heart, MessageCircle, Eye } from 'lucide-react';
import { t } from '../i18n';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useAuthStore } from '../store/auth';
import './Blogs.css';

export default function Blogs() {
  const [blogs, setBlogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<'latest' | 'hot'>('latest');
  const { user } = useAuthStore();
  useDocumentTitle(t('blogs.title'));

  useEffect(() => {
    fetchBlogs();
  }, [sort]);

  const fetchBlogs = async () => {
    setLoading(true);
    try {
      const data = await api.getBlogs({ sort, pageSize: 30 });
      setBlogs(data.blogs);
    } catch (e) {
      console.error('Failed to fetch blogs:', e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="blogs-page">
      <AdSlot position="blog_top" />
      <div className="blogs-header">
        <h1>{t('blogs.title')}</h1>
        <div className="blogs-actions">
          <div className="sort-tabs">
            <button className={`sort-tab ${sort === 'latest' ? 'active' : ''}`} onClick={() => setSort('latest')}>
              {t('blogs.sortLatest')}
            </button>
            <button className={`sort-tab ${sort === 'hot' ? 'active' : ''}`} onClick={() => setSort('hot')}>
              {t('blogs.sortHot')}
            </button>
          </div>
          {user && (
            <Link to="/blog/write" className="btn btn-primary btn-sm">
              <PenSquare size={14} />
              {t('blogs.writeBlog')}
            </Link>
          )}
        </div>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : blogs.length === 0 ? (
        <div className="empty-state">
          <PenSquare size={48} />
          <p>{t('blogs.noBlogs')}</p>
        </div>
      ) : (
        <div className="blogs-list">
          {blogs.map((b) => (
            <Link key={b.id} to={`/blogs/${b.id}`} className="blog-card">
              <div className="blog-card-header">
                {b.avatar_url ? (
                  <img src={b.avatar_url} alt={b.username} className="blog-avatar" />
                ) : (
                  <div className="blog-avatar placeholder">{b.username.charAt(0).toUpperCase()}</div>
                )}
                <div className="blog-author-info">
                  <span className="blog-author">{b.username}</span>
                  <span className="blog-date">{new Date(b.created_at).toLocaleDateString()}</span>
                </div>
              </div>
              <h3 className="blog-title">{b.title}</h3>
              {b.tags && (
                <div className="blog-tags">
                  {b.tags.split(',').map((tag: string, idx: number) => (
                    <span key={idx} className="blog-tag">{tag.trim()}</span>
                  ))}
                </div>
              )}
              <div className="blog-stats">
                <span><Eye size={14} /> {b.view_count}</span>
                <span><Heart size={14} /> {b.like_count}</span>
                <span><MessageCircle size={14} /> {b.comment_count}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
