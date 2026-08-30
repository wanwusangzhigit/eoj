import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { FileText, AlertCircle, ArrowLeft } from 'lucide-react';
import { renderMarkdown } from '../utils/markdown';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { t } from '../i18n';
import './CustomPage.css';

export default function CustomPage() {
  const { slug } = useParams<{ slug: string }>();
  const [page, setPage] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useDocumentTitle(page?.title || t('customPages.title'));

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setError('');
    api.getPage(slug)
      .then((d) => { setPage(d.page); })
      .catch((e: any) => setError(e.message || t('customPages.notFound')))
      .finally(() => setLoading(false));
  }, [slug]);

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
