import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import LoadingSpinner from '../components/LoadingSpinner';
import ImageUploadButton from '../components/ImageUploadButton';
import { Ticket, ChevronRight, Send, Clock, User } from 'lucide-react';
import { t } from '../i18n';
import { useToastStore } from '../store/toast';
import './TicketDetail.css';

const STATUS_BADGE_CLASS: Record<string, string> = {
  open: 'badge badge-warning',
  in_progress: 'badge badge-info',
  resolved: 'badge badge-success',
  closed: 'badge badge-closed',
};

const PRIORITY_BADGE_CLASS: Record<string, string> = {
  low: 'badge badge-priority-low',
  medium: 'badge badge-priority-medium',
  high: 'badge badge-error',
};

const CATEGORY_BADGE_CLASS: Record<string, string> = {
  bug: 'badge badge-error',
  suggestion: 'badge badge-info',
  question: 'badge badge-warning',
  other: 'badge badge-category-other',
};

export default function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const [ticket, setTicket] = useState<any>(null);
  const [replies, setReplies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [replyContent, setReplyContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  useEffect(() => {
    if (!id) return;
    fetchTicket();
  }, [id]);

  const fetchTicket = async () => {
    setLoading(true);
    try {
      const data = await api.getTicket(Number(id));
      setTicket(data.ticket);
      setReplies(data.replies || []);
    } catch (e: any) {
      useToastStore().addToast('error', t('ticketDetail.loadError'));
      console.error('Failed to fetch ticket:', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  const handleReply = async () => {
    if (!id || !replyContent.trim() || submitting) return;
    setSubmitting(true);
    try {
      await api.replyTicket(Number(id), replyContent.trim());
      setReplyContent('');
      fetchTicket();
    } catch (e: any) {
      useToastStore().addToast('error', e.message || t('common.error'));
      console.error('Failed to reply:', e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!id) return;
    try {
      await api.updateTicketStatus(Number(id), { status: newStatus });
      fetchTicket();
    } catch (e: any) {
      useToastStore().addToast('error', e.message || t('common.error'));
      console.error('Failed to update status:', e);
    }
  };

  const handlePriorityChange = async (newPriority: string) => {
    if (!id) return;
    try {
      await api.updateTicketStatus(Number(id), { priority: newPriority });
      fetchTicket();
    } catch (e: any) {
      useToastStore().addToast('error', e.message || t('common.error'));
      console.error('Failed to update priority:', e);
    }
  };

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
    return new Date(dateStr).toLocaleString();
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  if (loadError) {
    return (
      <div className="empty-container">
        <h2>{t('ticketDetail.loadError')}</h2>
        <Link to="/tickets" className="btn btn-primary">{t('tickets.title')}</Link>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="empty-container">
        <h2>{t('ticketDetail.notFound')}</h2>
        <Link to="/tickets" className="btn btn-primary">{t('tickets.title')}</Link>
      </div>
    );
  }

  return (
    <div className="ticket-detail-page">
      <div className="breadcrumb">
        <Link to="/tickets">{t('tickets.title')}</Link>
        <ChevronRight size={14} />
        <span>{ticket.title}</span>
      </div>

      <div className="ticket-info-card">
        <div className="ticket-info-header">
          <div className="ticket-info-title-section">
            <Ticket size={22} className="ticket-icon" />
            <h1 className="ticket-detail-title">{ticket.title}</h1>
          </div>
          <div className="ticket-badges">
            <span className={CATEGORY_BADGE_CLASS[ticket.category] || 'badge'}>
              {getCategoryLabel(ticket.category)}
            </span>
            <span className={STATUS_BADGE_CLASS[ticket.status] || 'badge'}>
              {getStatusLabel(ticket.status)}
            </span>
            <span className={PRIORITY_BADGE_CLASS[ticket.priority] || 'badge'}>
              {t('tickets.priority')}: {ticket.priority}
            </span>
          </div>
        </div>

        <div className="ticket-meta">
          <span className="meta-item">
            <User size={14} />
            {ticket.username || ticket.user_id}
          </span>
          <span className="meta-item">
            <Clock size={14} />
            {formatDate(ticket.created_at)}
          </span>
        </div>

        <div className="ticket-content">
          {ticket.content}
        </div>

        {isAdmin && (
          <div className="admin-controls">
            <div className="control-group">
              <label>{t('tickets.status')}:</label>
              <select
                className="control-select"
                value={ticket.status}
                onChange={(e) => handleStatusChange(e.target.value)}
              >
                <option value="open">{t('tickets.open')}</option>
                <option value="in_progress">{t('tickets.inProgress')}</option>
                <option value="resolved">{t('tickets.resolved')}</option>
                <option value="closed">{t('tickets.closed')}</option>
              </select>
            </div>
            <div className="control-group">
              <label>{t('tickets.priority')}:</label>
              <select
                className="control-select"
                value={ticket.priority}
                onChange={(e) => handlePriorityChange(e.target.value)}
              >
                <option value="low">{t('tickets.low')}</option>
                <option value="medium">{t('tickets.normal')}</option>
                <option value="high">{t('tickets.high')}</option>
              </select>
            </div>
          </div>
        )}
      </div>

      <div className="replies-section">
        <h3>{t('tickets.reply')} ({replies.length})</h3>
        {replies.length === 0 ? (
          <div className="no-replies">{t('ticketDetail.noReplies')}</div>
        ) : (
          <div className="replies-list">
            {replies.map((reply: any, idx: number) => (
              <div key={reply.id || idx} className="reply-item">
                <div className="reply-header">
                  <span className="reply-author">
                    <User size={14} />
                    {reply.username || reply.user_id}
                  </span>
                  <span className="reply-date">
                    <Clock size={12} />
                    {formatDate(reply.created_at)}
                  </span>
                </div>
                <div className="reply-content">{reply.content}</div>
              </div>
            ))}
          </div>
        )}

        {user && (
          <div className="reply-form">
            <textarea
              className="reply-textarea"
              placeholder={t('tickets.reply')}
              value={replyContent}
              onChange={(e) => setReplyContent(e.target.value)}
              rows={3}
            />
            <div style={{display:'flex',gap:'8px',alignItems:'center',marginTop:'8px'}}>
              <ImageUploadButton onInsert={(md) => setReplyContent(prev => prev + (prev ? '\n' : '') + md)} />
              <button
                className="btn btn-primary btn-sm"
                onClick={handleReply}
                disabled={submitting || !replyContent.trim()}
              >
                <Send size={14} />
                {t('tickets.reply')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
