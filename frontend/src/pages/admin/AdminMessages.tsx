import { useState, useEffect, useCallback } from 'react';
import { api } from '../../api/client';
import { useToastStore } from '../../store/toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { t } from '../../i18n';
import { Search, Trash2, ChevronLeft, ChevronRight, X, MessageSquare, Eye, Send } from 'lucide-react';
import '../Admin.css';

export default function AdminMessages() {
  useDocumentTitle(t('admin.messageManagement'));
  const addToast = useToastStore((s) => s.addToast);

  const [conversations, setConversations] = useState<any[]>([]);
  const [pagination, setPagination] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Detail view state
  const [selectedConv, setSelectedConv] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [msgPagination, setMsgPagination] = useState<any>(null);
  const [msgPage, setMsgPage] = useState(1);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // 定向/群发站内信
  const [broadcastTarget, setBroadcastTarget] = useState('');
  const [broadcastContent, setBroadcastContent] = useState('');
  const [sending, setSending] = useState(false);

  const handleBroadcast = async () => {
    if (!broadcastContent.trim() || sending) return;
    setSending(true);
    try {
      const targetId = broadcastTarget.trim() ? parseInt(broadcastTarget.trim()) : undefined;
      if (broadcastTarget.trim() && (!targetId || targetId <= 0)) {
        addToast('error', t('admin.broadcastTargetInvalid'));
        setSending(false);
        return;
      }
      const result = await api.sendAdminMessage(broadcastContent.trim(), targetId);
      addToast('success', targetId ? t('admin.broadcastSentTargeted') : t('admin.broadcastSentAll').replace('{0}', String(result.sent)));
      setBroadcastContent('');
      setBroadcastTarget('');
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchConversations = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getAdminConversations({
        page,
        pageSize: 20,
        search: debouncedSearch || undefined,
      });
      setConversations(data.conversations);
      setPagination(data.pagination);
    } catch (e: any) {
      addToast('error', e.message || t('common.loadError'));
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, addToast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchConversations();
  }, [fetchConversations]);

  const fetchMessages = async (convId: number, targetPage = 1) => {
    setLoadingMessages(true);
    try {
      const data = await api.getAdminConversationMessages(convId, { page: targetPage, pageSize: 50 });
      setMessages(data.messages);
      setMsgPagination(data.pagination);
      setMsgPage(targetPage);
    } catch (e: any) {
      addToast('error', e.message || t('common.loadError'));
    } finally {
      setLoadingMessages(false);
    }
  };

  const handleOpenConversation = (conv: any) => {
    setSelectedConv(conv);
    setMessages([]);
    setMsgPagination(null);
    setMsgPage(1);
    fetchMessages(conv.id, 1);
  };

  const handleDeleteMessage = async (msgId: number) => {
    if (!confirm(t('admin.deleteMessageConfirm'))) return;
    try {
      await api.deleteMessageAdmin(msgId);
      addToast('success', t('admin.messageDeleted'));
      if (selectedConv) {
        await fetchMessages(selectedConv.id, msgPage);
      }
      await fetchConversations();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const handleDeleteConversation = async (conv: any) => {
    if (!confirm(t('admin.deleteConversationConfirm'))) return;
    try {
      await api.deleteConversationAdmin(conv.id);
      addToast('success', t('admin.conversationDeleted'));
      setSelectedConv(null);
      await fetchConversations();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    }
  };

  const formatTime = (ts: string) => {
    if (!ts) return '';
    return new Date(ts).toLocaleString();
  };

  return (
    <div className="admin-form">
      <h2>{t('admin.messageManagement')}</h2>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: -8, marginBottom: 16 }}>
        {t('admin.messageModerationHint')}
      </p>

      <div className="admin-filters" style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div className="search-box">
          <Search size={16} />
          <input
            type="text"
            placeholder={t('admin.searchMessages')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
      </div>

      {/* 管理员定向/群发站内信 */}
      <div className="admin-card" style={{ marginBottom: 16, padding: 16 }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>
          <Send size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
          {t('admin.broadcastTitle')}
        </h3>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="number"
            placeholder={t('admin.broadcastTargetPlaceholder')}
            value={broadcastTarget}
            onChange={(e) => setBroadcastTarget(e.target.value)}
            style={{ width: 160 }}
            min={1}
          />
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('admin.broadcastTargetHint')}</span>
        </div>
        <textarea
          rows={3}
          placeholder={t('admin.broadcastContentPlaceholder')}
          value={broadcastContent}
          onChange={(e) => setBroadcastContent(e.target.value)}
          style={{ marginTop: 10 }}
        />
        <div style={{ marginTop: 10 }}>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleBroadcast}
            disabled={sending || !broadcastContent.trim()}
          >
            <Send size={14} />
            {sending ? t('common.submitting') : t('admin.broadcastSend')}
          </button>
        </div>
      </div>

      <div className="admin-table-container">
        <div className="pm-table-header">
          <span className="pm-col pm-col-id">ID</span>
          <span className="pm-col pm-col-title">{t('admin.participants')}</span>
          <span className="pm-col" style={{ width: '70px' }}>{t('admin.msgCount')}</span>
          <span className="pm-col" style={{ width: '180px' }}>{t('admin.lastMessage')}</span>
          <span className="pm-col" style={{ width: '140px' }}>{t('common.actions')}</span>
        </div>
        {loading ? (
          <div className="pm-empty">{t('common.loading')}</div>
        ) : conversations.length === 0 ? (
          <div className="pm-empty">{t('admin.noConversations')}</div>
        ) : (
          conversations.map((conv) => (
            <div key={conv.id} className="pm-table-row">
              <span className="pm-col pm-col-id">{conv.id}</span>
              <span className="pm-col pm-col-title">
                <a href={`/users/${conv.user_a_name}`} target="_blank" rel="noopener" className="link">
                  {conv.user_a_name}
                </a>
                <span style={{ margin: '0 6px', color: 'var(--text-muted)' }}>↔</span>
                <a href={`/users/${conv.user_b_name}`} target="_blank" rel="noopener" className="link">
                  {conv.user_b_name}
                </a>
              </span>
              <span className="pm-col" style={{ width: '70px' }}>{conv.message_count ?? 0}</span>
              <span className="pm-col" style={{ width: '180px', fontSize: 12 }}>
                {conv.last_message ? (
                  <>
                    <div style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '160px',
                    }}>
                      {conv.last_message}
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>
                      {formatTime(conv.last_message_at)}
                    </div>
                  </>
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>—</span>
                )}
              </span>
              <span className="pm-col" style={{ width: '140px', display: 'flex', gap: 6 }}>
                <button
                  className="btn-text-sm"
                  onClick={() => handleOpenConversation(conv)}
                  title={t('admin.viewConversation')}
                >
                  <Eye size={14} />
                </button>
                <button
                  className="btn-text-sm danger"
                  onClick={() => handleDeleteConversation(conv)}
                  title={t('admin.deleteConversation')}
                >
                  <Trash2 size={14} />
                </button>
              </span>
            </div>
          ))
        )}
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="pagination">
          <button className="btn-icon-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            <ChevronLeft size={14} />
          </button>
          <span>{t('common.page').replace('{0}', String(page)).replace('{1}', String(pagination.totalPages))}</span>
          <button className="btn-icon-sm" disabled={page >= pagination.totalPages} onClick={() => setPage(page + 1)}>
            <ChevronRight size={14} />
          </button>
        </div>
      )}

      {/* Conversation detail modal */}
      {selectedConv && (
        <div className="admin-modal-overlay" onClick={() => setSelectedConv(null)}>
          <div className="admin-modal admin-modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3>
                <MessageSquare size={16} style={{ display: 'inline', marginRight: 6 }} />
                {t('admin.conversation')} #{selectedConv.id}
              </h3>
              <button className="btn-icon-sm" onClick={() => setSelectedConv(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="admin-modal-body">
              <div className="conv-detail-meta">
                <div>
                  <strong>{t('admin.participants')}:</strong>{' '}
                  <a href={`/users/${selectedConv.user_a_name}`} target="_blank" rel="noopener" className="link">
                    {selectedConv.user_a_name}
                  </a>
                  {' ↔ '}
                  <a href={`/users/${selectedConv.user_b_name}`} target="_blank" rel="noopener" className="link">
                    {selectedConv.user_b_name}
                  </a>
                </div>
                <div><strong>{t('admin.createdAt')}:</strong> {formatTime(selectedConv.created_at)}</div>
                {selectedConv.updated_at && (
                  <div><strong>{t('admin.updatedAt')}:</strong> {formatTime(selectedConv.updated_at)}</div>
                )}
              </div>
              <div className="msg-list-admin">
                {loadingMessages ? (
                  <div className="pm-empty">{t('common.loading')}</div>
                ) : messages.length === 0 ? (
                  <div className="pm-empty">{t('messages.noMessages')}</div>
                ) : (
                  [...messages].reverse().map((m) => (
                    <div key={m.id} className={`msg-row-admin ${m.sender_name === selectedConv.user_a_name ? 'own-a' : 'own-b'}`}>
                      <div className="msg-row-header">
                        <a href={`/users/${m.sender_name}`} target="_blank" rel="noopener" className="link">
                          {m.sender_name}
                        </a>
                        <span className="msg-row-time">{formatTime(m.created_at)}</span>
                        <button
                          className="btn-text-sm danger msg-delete-btn"
                          onClick={() => handleDeleteMessage(m.id)}
                          title={t('common.delete')}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <div className="msg-row-content">{m.content}</div>
                    </div>
                  ))
                )}
              </div>

              {/* Conversation message pagination */}
              {msgPagination && msgPagination.totalPages > 1 && (
                <div className="pagination">
                  <button
                    className="btn-icon-sm"
                    disabled={msgPage <= 1}
                    onClick={() => fetchMessages(selectedConv.id, msgPage - 1)}
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span>{t('common.page').replace('{0}', String(msgPage)).replace('{1}', String(msgPagination.totalPages))}</span>
                  <button
                    className="btn-icon-sm"
                    disabled={msgPage >= msgPagination.totalPages}
                    onClick={() => fetchMessages(selectedConv.id, msgPage + 1)}
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              )}
            </div>
            <div className="admin-form-actions">
              <button
                className="btn btn-danger btn-sm"
                onClick={() => handleDeleteConversation(selectedConv)}
              >
                <Trash2 size={14} /> {t('admin.deleteConversation')}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setSelectedConv(null)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
