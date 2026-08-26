import { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import AdSlot from '../components/AdSlot';
import { PenSquare, Heart, MessageCircle, Eye } from 'lucide-react';
import { t } from '../i18n';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useAuthStore } from '../store/auth';
import { useSSRPage } from '../ssr/useSSRPage';
import './Blogs.css';

// SSR 注入数据(对应 backend/src/loaders.ts 中 blogs loader 的返回)
interface BlogsSSRData {
  blogs?: any[];
}

export default function Blogs() {
  const ssr = useSSRPage<BlogsSSRData>('blogs');
  const firstRunRef = useRef<boolean>(true);
  const [blogs, setBlogs] = useState<any[]>(ssr?.blogs ?? []);
  const [loading, setLoading] = useState(!ssr);
  const [sort, setSort] = useState<'latest' | 'hot'>('latest');
  const [view, setView] = useState<'all' | 'mine'>('all');
  const { user } = useAuthStore();
  useDocumentTitle(t('blogs.title'));

  const fetchBlogs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getBlogs({ sort, pageSize: 30, mine: view === 'mine' });
      setBlogs(data.blogs);
    } catch (e) {
      console.error('Failed to fetch blogs:', e);
    } finally {
      setLoading(false);
    }
  }, [sort, view]);

  useEffect(() => {
    // SSR 已注入数据则跳过首次拉取(避免重复请求与首屏闪烁)
    if (ssr && firstRunRef.current) {
      firstRunRef.current = false;
      return;
    }
    firstRunRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchBlogs();
  }, [fetchBlogs, ssr]);

  return (
    <div className="blogs-page">
      <AdSlot position="blog_top" />
      <div className="blogs-header">
        <h1>{t('blogs.title')}</h1>
        <div className="blogs-actions">
          <div className="sort-tabs">
            {user && (
              <button className={`sort-tab ${view === 'all' ? 'active' : ''}`} onClick={() => setView('all')}>
                {t('blogs.allBlogs')}
              </button>
            )}
            <button className={`sort-tab ${sort === 'latest' ? 'active' : ''}`} onClick={() => setSort('latest')}>
              {t('blogs.sortLatest')}
            </button>
            <button className={`sort-tab ${sort === 'hot' ? 'active' : ''}`} onClick={() => setSort('hot')}>
              {t('blogs.sortHot')}
            </button>
            {user && (
              <button className={`sort-tab ${view === 'mine' ? 'active' : ''}`} onClick={() => setView('mine')}>
                {t('blogs.myBlogs')}
              </button>
            )}
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
                {b.status === 'draft' && (
                  <span className="draft-badge">{t('blogs.draft')}</span>
                )}
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
                {view === 'mine' && (
                  <Link
                    to={`/blog/${b.id}/edit`}
                    className="blog-edit-link"
                    onClick={(e) => e.stopPropagation()}
                    title={t('blogs.editBlog')}
                  >
                    {t('common.edit')}
                  </Link>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
