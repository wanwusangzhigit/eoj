import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import { useToastStore } from '../store/toast';
import { Code2, User, Clock, AlertCircle, Calendar, ImageIcon, Lock, Unlock, Trash2 } from 'lucide-react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { t } from '../i18n';
import './ShareView.css';

export default function ShareView() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const addToast = useToastStore((s) => s.addToast);
  const [share, setShare] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copyDone, setCopyDone] = useState(false);
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [wrongPassword, setWrongPassword] = useState(false);
  useDocumentTitle(share?.title || t('shares.title'));

  const isOwner = !!user && !!share && (share.username === user.username || user.role === 'admin' || user.role === 'super_admin');

  const handleDelete = async () => {
    if (!token || !share) return;
    if (!window.confirm(t('shares.deleteConfirm'))) return;
    try {
      await api.deleteCodeShare(token);
      addToast('success', t('shares.shareDeleted'));
      navigate('/');
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const loadShare = (pwd?: string) => {
    if (!token) return;
    setLoading(true);
    setError('');
    setWrongPassword(false);
    api.getCodeShare(token, pwd)
      .then((d) => {
        setShare(d.share);
        if (d.requires_password) {
          setRequiresPassword(true);
          setWrongPassword(!!pwd); // 已尝试过密码仍要求 → 密码错误
        } else {
          setRequiresPassword(false);
        }
      })
      .catch((e: any) => setError(e.message || t('shares.notFound')))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadShare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setUnlocking(true);
    await loadShare(password.trim());
    setUnlocking(false);
  };

  const handleCopy = () => {
    if (!share) return;
    navigator.clipboard?.writeText(share.code).then(() => {
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 1500);
    }).catch(() => {});
  };

  // 下载代码图片
  const handleDownloadImage = async () => {
    if (!token) return;
    try {
      await api.downloadShareImage(token);
    } catch (e: any) {
      setError(e.message || t('common.error'));
    }
  };

  if (loading) {
    return <div className="share-page"><div className="loading-container"><div className="loading-spinner"></div></div></div>;
  }

  if (error || !share) {
    return (
      <div className="share-page">
        <div className="share-error">
          <AlertCircle size={40} />
          <p>{error || t('shares.notFound')}</p>
          <Link to="/" className="btn btn-primary btn-sm">{t('common.back')}</Link>
        </div>
      </div>
    );
  }

  // 密码保护:解锁前不展示代码
  if (requiresPassword) {
    return (
      <div className="share-page">
        <div className="share-lock-card">
          <Lock size={36} className="share-lock-icon" />
          <h1>{t('shares.passwordRequired')}</h1>
          <p className="share-lock-desc">{t('shares.passwordHint')}</p>
          {wrongPassword && <p className="share-lock-error">{t('shares.wrongPassword')}</p>}
          <form className="share-lock-form" onSubmit={handleUnlock}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('shares.passwordPlaceholder')}
              autoFocus
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={unlocking || !password.trim()}>
              <Unlock size={14} /> {unlocking ? t('common.loading') : t('shares.unlock')}
            </button>
          </form>
          <Link to="/" className="btn btn-secondary btn-sm share-lock-back">{t('common.back')}</Link>
        </div>
      </div>
    );
  }

  const expired = share.expires_at && new Date(share.expires_at) < new Date();

  return (
    <div className="share-page">
      <div className="share-header">
        <div className="share-title-block">
          <Code2 size={20} className="share-icon" />
          <h1>{share.title}</h1>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={handleCopy}>
          {copyDone ? t('shares.copied') : t('shares.copyCode')}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={handleDownloadImage} title={t('shares.downloadImage')}>
          <ImageIcon size={14} /> {t('shares.downloadImage')}
        </button>
        {isOwner && (
          <button className="btn btn-danger btn-sm" onClick={handleDelete} title={t('shares.deleteShare')}>
            <Trash2 size={14} /> {t('shares.deleteShare')}
          </button>
        )}
      </div>

      <div className="share-meta">
        <span><User size={13} /> {share.username}</span>
        {share.language && <span className="share-lang">{share.language}</span>}
        <span><Calendar size={13} /> {new Date(share.created_at).toLocaleString()}</span>
        {share.expires_at && (
          <span className={expired ? 'share-expired' : ''}>
            <Clock size={13} />
            {expired ? t('shares.expired') : `${t('shares.expires')}: ${new Date(share.expires_at).toLocaleString()}`}
          </span>
        )}
        {share.submission_id && (
          <Link to={`/submissions/${share.submission_id}`} className="share-source-link">
            {t('shares.viewSubmission')} #{share.submission_id}
          </Link>
        )}
      </div>

      <pre className="share-code"><code>{share.code || t('shares.noContent')}</code></pre>
    </div>
  );
}
