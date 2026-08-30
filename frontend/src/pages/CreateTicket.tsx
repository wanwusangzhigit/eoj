import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import { Ticket, ChevronRight, Send } from 'lucide-react';
import { t } from '../i18n';
import './CreateTicket.css';

const CATEGORIES = [
  { value: 'bug', label: () => t('tickets.bug') },
  { value: 'suggestion', label: () => t('tickets.suggestion') },
  { value: 'question', label: () => t('tickets.question') },
  { value: 'other', label: () => t('tickets.other') },
];

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
];

export default function CreateTicket() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('question');
  const [priority, setPriority] = useState('normal');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!user) {
    return (
      <div className="empty-container">
        <h2>{t('tickets.loginRequired')}</h2>
        <Link to="/login" className="btn btn-primary">{t('login.title')}</Link>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim() || submitting) return;

    setSubmitting(true);
    setError('');
    try {
      const data = await api.createTicket({
        title: title.trim(),
        content: content.trim(),
        category,
        priority,
      });
      navigate(`/tickets/${data.id}`);
    } catch (e: any) {
      setError(e.message || t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="create-ticket-page">
      <div className="breadcrumb">
        <Link to="/tickets">{t('tickets.title')}</Link>
        <ChevronRight size={14} />
        <span>{t('tickets.createTicket')}</span>
      </div>

      <div className="create-ticket-card">
        <div className="create-ticket-header">
          <Ticket size={22} className="ticket-icon" />
          <h1>{t('tickets.createTicket')}</h1>
        </div>

        {error && <div className="form-error">{error}</div>}

        <form onSubmit={handleSubmit} className="ticket-form">
          <div className="form-group">
            <label>{t('tickets.title')}</label>
            <input
              type="text"
              className="form-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('tickets.titlePlaceholder')}
              required
              maxLength={200}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>{t('tickets.category')}</label>
              <select
                className="form-select"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>{cat.label()}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>{t('tickets.priority')}</label>
              <select
                className="form-select"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>{t('tickets.content')}</label>
            <textarea
              className="form-textarea"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t('tickets.contentPlaceholder')}
              required
              rows={8}
            />
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate('/tickets')}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || !title.trim() || !content.trim()}
            >
              <Send size={14} />
              {submitting ? (t('common.loading')) : (t('tickets.createTicket'))}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
