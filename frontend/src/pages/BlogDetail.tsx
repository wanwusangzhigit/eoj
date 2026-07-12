import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import { Heart, MessageCircle, Eye, ArrowLeft, Trash2, Edit } from 'lucide-react';
import { t } from '../i18n';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useAuthStore } from '../store/auth';
import { useToastStore } from '../store/toast';
import { renderMarkdown } from '../utils/markdown';
import './Blogs.css';

export default function BlogDetail() {
  const { id } = useParams<{ id: string }>();
  const blogId = parseInt(id || '0');
  const { user } = useAuthStore();
  const addToast = useToastStore((s) => s.addToast);
  const [blog, setBlog] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [liked, setLiked] = useState(false);
  const [commentInput, setCommentInput] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  useDocumentTitle(blog?.title || t('blogs.title'));

  useEffect(() => {
    fetchBlog();
    fetchComments();
  }, [blogId]);

  const fetchBlog = async () => {
    setLoading(true);
    try {
      const data = await api.getBlog(blogId);
      setBlog(data.blog);
      if (user) {
        try {
          const status = await api.getBlogLikeStatus(blogId);
          setLiked(status.liked);
        } catch { /* ignore */ }
      }
    } catch (e: any) {
      addToast('error', e.message || t('common.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const fetchComments = async () => {
    try {
      const data = await api.getBlogComments(blogId, { pageSize: 100 });
      setComments(data.comments);
    } catch (e) {
      console.error('Failed to fetch comments:', e);
    }
  };

  const handleLike = async () => {
    try {
      const result = await api.likeBlog(blogId);
      setLiked(result.liked);
      setBlog({ ...blog, like_count: blog.like_count + (result.liked ? 1 : -1) });
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentInput.trim()) return;
    setPostingComment(true);
    try {
      await api.postBlogComment(blogId, commentInput.trim());
      setCommentInput('');
      addToast('success', t('blogs.commentPosted'));
      await fetchComments();
      setBlog({ ...blog, comment_count: blog.comment_count + 1 });
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      setPostingComment(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(t('blogs.deleteBlog') + '?')) return;
    try {
      await api.deleteBlog(blogId);
      addToast('success', t('blogs.blogDeleted'));
      window.location.href = '/blogs';
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  if (loading) return <LoadingSpinner />;
  if (!blog) return <div className="empty-state">{t('blogs.noBlogs')}</div>;

  const isOwner = blog.user_id === user?.id;
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin' || user?.id === 1;

  return (
    <div className="blog-detail-page">
      <Link to="/blogs" className="back-link">
        <ArrowLeft size={16} />
        {t('blogs.backToBlogs')}
      </Link>

      <article className="blog-article">
        <header className="article-header">
          <h1>{blog.title}</h1>
          <div className="article-meta">
            {blog.avatar_url ? (
              <img src={blog.avatar_url} alt={blog.username} className="blog-avatar sm" />
            ) : (
              <div className="blog-avatar sm placeholder">{blog.username?.charAt(0).toUpperCase()}</div>
            )}
            <Link to={`/users/${blog.username}`} className="article-author">{blog.username}</Link>
            <span className="meta-sep">·</span>
            <span>{new Date(blog.created_at).toLocaleString()}</span>
            {blog.status === 'draft' && <span className="draft-badge">{t('blogs.draft')}</span>}
          </div>
          {blog.tags && (
            <div className="blog-tags">
              {blog.tags.split(',').map((tag: string, idx: number) => (
                <span key={idx} className="blog-tag">{tag.trim()}</span>
              ))}
            </div>
          )}
        </header>
        <div className="article-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(blog.content || '') }} />
        <footer className="article-footer">
          <div className="article-actions">
            <button className={`action-btn ${liked ? 'liked' : ''}`} onClick={handleLike} disabled={!user}>
              <Heart size={18} fill={liked ? 'currentColor' : 'none'} />
              <span>{blog.like_count}</span>
            </button>
            <span className="action-btn">
              <MessageCircle size={18} />
              <span>{blog.comment_count}</span>
            </span>
            <span className="action-btn">
              <Eye size={18} />
              <span>{blog.view_count}</span>
            </span>
            {(isOwner || isAdmin) && (
              <div className="owner-actions">
                <Link to={`/blog/${blog.id}/edit`} className="btn-icon-sm" title={t('blogs.editBlog')}>
                  <Edit size={14} />
                </Link>
                <button className="btn-icon-sm danger" onClick={handleDelete} title={t('blogs.deleteBlog')}>
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </div>
        </footer>
      </article>

      <section className="comments-section">
        <h2>{t('blogs.comments')} ({comments.length})</h2>
        {user && (
          <form className="comment-form" onSubmit={handlePostComment}>
            <textarea
              placeholder={t('blogs.commentPlaceholder')}
              value={commentInput}
              onChange={(e) => setCommentInput(e.target.value)}
              rows={3}
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={postingComment || !commentInput.trim()}>
              {postingComment ? t('common.submitting') : t('blogs.postComment')}
            </button>
          </form>
        )}
        <div className="comments-list">
          {comments.length === 0 ? (
            <div className="empty-text">{t('blogs.noComments')}</div>
          ) : (
            comments.map((c) => (
              <div key={c.id} className="comment-item">
                {c.avatar_url ? (
                  <img src={c.avatar_url} alt={c.username} className="blog-avatar sm" />
                ) : (
                  <div className="blog-avatar sm placeholder">{c.username?.charAt(0).toUpperCase()}</div>
                )}
                <div className="comment-body">
                  <div className="comment-header">
                    <Link to={`/users/${c.username}`} className="comment-author">{c.username}</Link>
                    <span className="comment-time">{new Date(c.created_at).toLocaleString()}</span>
                  </div>
                  <div className="comment-text" dangerouslySetInnerHTML={{ __html: renderMarkdown(c.content || '') }} />
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
