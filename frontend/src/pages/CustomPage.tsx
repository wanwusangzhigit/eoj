import { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { FileText, AlertCircle, ArrowLeft } from 'lucide-react';
import { renderMarkdown } from '../utils/markdown';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { t } from '../i18n';
import { useSSRPage } from '../ssr/useSSRPage';
import './CustomPage.css';

// SSR 注入数据(对应 backend/src/loaders.ts 中 customPage loader 的返回)
interface CustomPageSSRData {
  page?: { page: any } | null;
}

export default function CustomPage() {
  const { slug } = useParams<{ slug: string }>();
  const ssr = useSSRPage<CustomPageSSRData>('customPage');
  const firstRunRef = useRef<boolean>(true);
  const [page, setPage] = useState<any>(ssr?.page?.page ?? null);
  const [loading, setLoading] = useState(!ssr);
  const [error, setError] = useState('');
  useDocumentTitle(page?.title || t('customPages.title'));

  useEffect(() => {
    if (!slug) return;
    // SSR 已注入数据则跳过首次拉取(避免重复请求与首屏闪烁)
    if (ssr && firstRunRef.current) {
      firstRunRef.current = false;
      return;
    }
    firstRunRef.current = false;
    setLoading(true);
    setError('');
    api.getPage(slug)
      .then((d) => { setPage(d.page); })
      .catch((e: any) => setError(e.message || t('customPages.notFound')))
      .finally(() => setLoading(false));
  }, [slug, ssr]);

  if (loading) {
    return <div className="custom-page-page"><div className="loading-container"><div className="loading-spinner"></div></div></div>;
  }

  if (error || !page) {
    return (
      <div className="custom-page-page">
        <div className="custom-page-error">
          <AlertCircle size={40} />
          <p>{error || t('customPages.notFound')}</p>
          <Link to="/" className="btn btn-primary btn-sm">{t('common.back')}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="custom-page-page">
      <div className="custom-page-header">
        <FileText size={20} className="custom-page-icon" />
        <h1>{page.title}</h1>
      </div>
      <div className="custom-page-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(page.content || '') }} />
      <div className="custom-page-footer">
        <Link to="/" className="btn btn-secondary btn-sm"><ArrowLeft size={14} /> {t('common.back')}</Link>
      </div>
    </div>
  );
}
