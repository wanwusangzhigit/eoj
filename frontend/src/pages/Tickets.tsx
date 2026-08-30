import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import { Ticket, Filter, PlusCircle, Clock, AlertCircle } from 'lucide-react';
import { t } from '../i18n';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import './Tickets.css';

const STATUS_OPTIONS = ['all', 'open', 'in_progress', 'resolved', 'closed'] as const;
const CATEGORY_OPTIONS = ['all', 'bug', 'suggestion', 'question', 'other'] as const;

const STATUS_BADGE_CLASS: Record<string, string> = {
  open: 'badge badge-warning',
  in_progress: 'badge badge-info',
  resolved: 'badge badge-success',
  closed: 'badge badge-closed',
};

const CATEGORY_BADGE_CLASS: Record<string, string> = {
  bug: 'badge badge-error',
  suggestion: 'badge badge-info',
  question: 'badge badge-warning',
  other: 'badge badge-category-other',
};

export default function Tickets() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  useDocumentTitle(t('tickets.title'));

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await api.getTickets({
        status: statusFilter !== 'all' ? statusFilter : undefined,
        category: categoryFilter !== 'all' ? categoryFilter : undefined,
      });
      setTickets(data.tickets);
    } catch (e) {
      console.error('Failed to fetch tickets:', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, categoryFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTickets();
  }, [fetchTickets]);

  const getStatusLabel = (status: string) => {
    if (status === 'open') return t('tickets.open');
    if (status === 'in_progress') return t('tickets.inProgress');
    if (status === 'resolved') return t('tickets.resolved');
    return t('tickets.closed');
  };

  const getCategoryLabel = (category: string) => {
    if (category === 'bug') return t('tickets.bug');
    if (category === 'suggestion') return t('tickets.suggestion');
    if (category === 'question') return t('tickets.question');
    return t('tickets.other');
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString();
  };

  return (
    <div className="tickets-page">
      <div className="tickets-header">
        <div className="tickets-title-section">
          <Ticket size={28} className="title-icon" />
          <h1 className="page-title">{t('tickets.title')}</h1>
        </div>
        <Link to="/tickets/new" className="btn btn-primary btn-sm">
          <PlusCircle size={14} />
          {t('tickets.createTicket')}
        </Link>
      </div>

      <div className="tickets-filters">
        <div className="filter-group">
          <Filter size={14} />
          <span className="filter-label">{t('tickets.status')}:</span>
          {STATUS_OPTIONS.map((status) => (
            <button
              key={status}
              className={`filter-btn ${statusFilter === status ? 'active' : ''}`}
              onClick={() => setStatusFilter(status)}
            >
              {status === 'all' ? t('common.all') : getStatusLabel(status)}
            </button>
          ))}
        </div>

        <div className="filter-group">
          <span className="filter-label">{t('tickets.category')}:</span>
          {CATEGORY_OPTIONS.map((cat) => (
            <button
              key={cat}
              className={`filter-btn ${categoryFilter === cat ? 'active' : ''}`}
              onClick={() => setCategoryFilter(cat)}
            >
              {cat === 'all' ? t('common.all') : getCategoryLabel(cat)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : loadError ? (
        <div className="error-banner">
          <AlertCircle size={16} />
          <span>{t('common.loadError')}</span>
          <button className="btn btn-secondary btn-sm" onClick={fetchTickets}>{t('common.retry')}</button>
        </div>
      ) : tickets.length === 0 ? (
        <EmptyState
          icon={Ticket}
          title={t('tickets.noTickets')}
        />
      ) : (
        <div className="tickets-list">
          {tickets.map((ticket) => (
            <Link
              key={ticket.id}
              to={`/tickets/${ticket.id}`}
              className="ticket-card"
            >
              <div className="ticket-card-header">
                <h3 className="ticket-title">{ticket.title}</h3>
                <div className="ticket-badges">
                  <span className={CATEGORY_BADGE_CLASS[ticket.category] || 'badge'}>
                    {getCategoryLabel(ticket.category)}
                  </span>
                  <span className={STATUS_BADGE_CLASS[ticket.status] || 'badge'}>
                    {getStatusLabel(ticket.status)}
                  </span>
                </div>
              </div>
              <div className="ticket-card-footer">
                <span className="ticket-date">
                  <Clock size={12} />
                  {formatDate(ticket.created_at)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
