import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { useToastStore } from '../../store/toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { t } from '../../i18n';
import {
  ChevronLeft, ChevronRight, ExternalLink,
} from 'lucide-react';
import '../Admin.css';

export default function AdminTickets() {
  useDocumentTitle(t('admin.ticketManagement'));
  const addToast = useToastStore((s) => s.addToast);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey(k => k + 1);

  const [adminTickets, setAdminTickets] = useState<any[]>([]);
  const [ticketPagination, setTicketPagination] = useState<any>(null);
  const [ticketPage, setTicketPage] = useState(1);
  const [ticketStatusFilter, setTicketStatusFilter] = useState('');

  useEffect(() => {
    fetchAdminTickets();
  }, [ticketPage, ticketStatusFilter, refreshKey]);

  const fetchAdminTickets = async () => {
    try {
      const data = await api.getAdminTickets({ page: ticketPage, pageSize: 10, status: ticketStatusFilter || undefined });
      setAdminTickets(data.tickets);
      setTicketPagination(data.pagination);
    } catch (e) { console.error('Failed to fetch tickets:', e); }
  };

  const handleTicketStatusChange = async (id: number, status: string) => {
    try {
      await api.updateTicketStatus(id, { status });
      addToast('success', t('common.success'));
      refresh();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  return (
    <div className="admin-form">
      <h2>{t('admin.ticketManagement')}</h2>
      <div className="filter-bar" style={{marginBottom:'12px'}}>
        <select className="filter-select" value={ticketStatusFilter} onChange={(e) => { setTicketStatusFilter(e.target.value); setTicketPage(1); }}>
          <option value="">{t('tickets.allStatus')}</option>
          <option value="open">{t('tickets.open')}</option>
          <option value="in_progress">{t('tickets.inProgress')}</option>
          <option value="resolved">{t('tickets.resolved')}</option>
          <option value="closed">{t('tickets.closed')}</option>
        </select>
      </div>
      <div className="admin-table-container">
        <div className="pm-table-header">
          <span className="pm-col pm-col-id">{t('common.id')}</span>
          <span className="pm-col pm-col-title">{t('tickets.title')}</span>
          <span className="pm-col" style={{width:'80px'}}>{t('tickets.category')}</span>
          <span className="pm-col" style={{width:'120px'}}>{t('tickets.status')}</span>
          <span className="pm-col" style={{width:'80px'}}>{t('tickets.priority')}</span>
          <span className="pm-col" style={{width:'100px'}}>{t('admin.user')}</span>
          <span className="pm-col" style={{width:'120px'}}>{t('common.actions')}</span>
        </div>
        {adminTickets.length === 0 ? (
          <div className="pm-empty">{t('common.noData')}</div>
        ) : (
          adminTickets.map((tk: any) => (
            <div key={tk.id} className="pm-table-row">
              <span className="pm-col pm-col-id">{tk.id}</span>
              <span className="pm-col pm-col-title">
                <a href={`/tickets/${tk.id}`} style={{color:'inherit',textDecoration:'none'}}>{tk.title}</a>
              </span>
              <span className="pm-col" style={{width:'80px'}}>
                <span className={`badge ${tk.category === 'bug' ? 'badge-error' : tk.category === 'suggestion' ? 'badge-info' : 'badge-warning'}`}>
                  {tk.category}
                </span>
              </span>
              <span className="pm-col" style={{width:'120px'}}>
                <select
                  className="admin-status-select"
                  value={tk.status}
                  onChange={(e) => handleTicketStatusChange(tk.id, e.target.value)}
                  title={t('admin.changeStatus')}
                >
                  <option value="open">{t('tickets.open')}</option>
                  <option value="in_progress">{t('tickets.inProgress')}</option>
                  <option value="resolved">{t('tickets.resolved')}</option>
                  <option value="closed">{t('tickets.closed')}</option>
                </select>
              </span>
              <span className="pm-col" style={{width:'80px'}}>{tk.priority}</span>
              <span className="pm-col" style={{width:'100px'}}>{tk.username}</span>
              <span className="pm-col" style={{width:'120px'}}>
                <div className="admin-row-actions">
                  <a href={`/tickets/${tk.id}`} className="btn-text-sm" title={t('admin.viewTicket')}>
                    <ExternalLink size={13} /> {t('admin.viewTicket')}
                  </a>
                </div>
              </span>
            </div>
          ))
        )}
      </div>
      {ticketPagination && ticketPagination.totalPages > 1 && (
        <div className="pm-pagination">
          <button className="btn btn-secondary btn-sm" disabled={ticketPage <= 1} onClick={() => setTicketPage(ticketPage - 1)}>
            <ChevronLeft size={14} />
          </button>
          <span className="pm-page-info">{ticketPage} / {ticketPagination.totalPages}</span>
          <button className="btn btn-secondary btn-sm" disabled={ticketPage >= ticketPagination.totalPages} onClick={() => setTicketPage(ticketPage + 1)}>
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
