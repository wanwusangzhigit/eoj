import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { ArrowLeft } from 'lucide-react';
import Captcha from '../components/Captcha';
import type { CaptchaHandle } from '../components/Captcha';
import { t } from '../i18n';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToastStore } from '../store/toast';
import './Blogs.css';

export default function BlogEditor() {
  const { id } = useParams<{ id?: string }>();
  const blogId = id ? parseInt(id) : null;
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const [form, setForm] = useState({ title: '', content: '', tags: '', status: 'published' });
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [captchaUuid, setCaptchaUuid] = useState('');
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const captchaRef = useRef<CaptchaHandle>(null);
  useDocumentTitle(blogId ? t('blogs.editBlog') : t('blogs.writeBlog'));

  useEffect(() => {
    if (blogId) fetchBlog();
  }, [blogId]);

  const fetchBlog = async () => {
    setLoading(true);
    try {
      const data = await api.getBlog(blogId!);
      setForm({
        title: data.blog.title,
        content: data.blog.content,
        tags: data.blog.tags || '',
        status: data.blog.status,
      });
    } catch (e: any) {
      addToast('error', e.message || t('common.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.content.trim()) {
      addToast('error', t('blogs.blogTitle'));
      return;
    }
    setSubmitting(true);
    try {
      if (blogId) {
        await api.updateBlog(blogId, form);
        addToast('success', t('blogs.blogUpdated'));
        navigate(`/blogs/${blogId}`);
      } else {
        const result = await api.createBlog({ ...form, captcha_uuid: captchaUuid, captcha_answer: captchaAnswer });
        addToast('success', t('blogs.blogCreated'));
        navigate(`/blogs/${result.id}`);
      }
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
      if (e.message?.includes('CAPTCHA')) {
        captchaRef.current?.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="empty-state">{t('common.loading')}</div>;

  return (
    <div className="blog-editor-page">
      <button className="btn btn-secondary btn-sm" onClick={() => navigate(blogId ? `/blogs/${blogId}` : '/blogs')}>
        <ArrowLeft size={14} />
        {t('blogs.backToBlogs')}
      </button>
      <h1 style={{ marginTop: 16 }}>{blogId ? t('blogs.editBlog') : t('blogs.writeBlog')}</h1>
      <form className="blog-editor-form" onSubmit={handleSubmit}>
        <label>
          <span>{t('blogs.blogTitle')}</span>
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
          />
        </label>
        <label>
          <span>{t('blogs.blogContent')}</span>
          <textarea
            rows={20}
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            placeholder="支持 Markdown 语法..."
            required
          />
        </label>
        <label>
          <span>{t('blogs.blogTags')}</span>
          <input
            type="text"
            value={form.tags}
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
            placeholder={t('blogs.tagHint')}
          />
        </label>
        {!blogId && (
          <Captcha
            ref={captchaRef}
            onCaptchaReady={({ uuid }) => setCaptchaUuid(uuid)}
            onCaptchaChange={(answer) => setCaptchaAnswer(answer)}
            captchaAnswer={captchaAnswer}
          />
        )}
        <div className="editor-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setForm({ ...form, status: 'draft' })}
            disabled={submitting}
          >
            {t('blogs.saveDraft')}
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting}
            onClick={() => setForm({ ...form, status: 'published' })}
          >
            {submitting ? t('common.submitting') : t('blogs.publish')}
          </button>
        </div>
      </form>
    </div>
  );
}
