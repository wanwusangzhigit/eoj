import { Link } from 'react-router-dom';
import { SearchX, Home, Target, Mail } from 'lucide-react';
import { t } from '../i18n';
import './NotFound.css';

export default function NotFound() {
  return (
    <div className="not-found">
      <SearchX size={64} className="not-found-icon" />
      <h1 className="not-found-code">404</h1>
      <h2 className="not-found-title">{t('notFound.title')}</h2>
      <p className="not-found-message">
        {t('notFound.description')}
      </p>
      <div className="not-found-links" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 }}>
        <Link to="/" className="btn btn-primary">
          <Home size={16} /> {t('notFound.backHome')}
        </Link>
        <Link to="/problems" className="btn btn-secondary">
          <Target size={16} /> 题目列表
        </Link>
        <Link to="/contact" className="btn btn-secondary">
          <Mail size={16} /> 联系支持
        </Link>
      </div>
    </div>
  );
}
