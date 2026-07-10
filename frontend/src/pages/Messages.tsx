import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { MessageSquare, Send, ArrowLeft, Plus, Search, X } from 'lucide-react';
import { t } from '../i18n';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useAuthStore } from '../store/auth';
import { useToastStore } from '../store/toast';
import './Messages.css';

export default function Messages() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const addToast = useToastStore((s) => s.addToast);
  useDocumentTitle(t('messages.title'));

  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(id ? parseInt(id) : null);
  const [messages, setMessages] = useState<any[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // New conversation target (from query string ?target=userId)
  const [targetUserId, setTargetUserId] = useState<number | null>(null);

  // New conversation dialog state
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  // Pagination for messages in current conversation
  const [messagesPage, setMessagesPage] = useState(1);
  const [messagesPagination, setMessagesPagination] = useState<any>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const target = params.get('target');
    if (target) {
      setTargetUserId(parseInt(target));
    }
  }, []);

  useEffect(() => {
    fetchConversations();
  }, []);

  // Auto-refresh conversations list every 15s to pick up new messages / unread counts
  useEffect(() => {
    const timer = setInterval(fetchConversationsSilent, 15000);
    return () => clearInterval(timer);
  }, []);

  // When in an active conversation, poll for new messages every 10s
  useEffect(() => {
    if (!selectedId) return;
    const timer = setInterval(() => fetchMessagesSilent(selectedId), 10000);
    return () => clearInterval(timer);
  }, [selectedId]);

  useEffect(() => {
    if (selectedId) {
      setMessagesPage(1);
      fetchMessages(selectedId);
      api.markConversationRead(selectedId).catch(() => { /* ignore */ });
    }
  }, [selectedId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchConversations = async () => {
    setLoading(true);
    try {
      const data = await api.getConversations();
      setConversations(data.conversations);
    } catch (e: any) {
      addToast('error', e.message || t('common.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const fetchConversationsSilent = async () => {
    try {
      const data = await api.getConversations();
      setConversations(data.conversations);
    } catch { /* ignore */ }
  };

  const fetchMessages = async (convId: number) => {
    try {
      const data = await api.getConversation(convId, { page: 1, pageSize: 50 });
      setMessages(data.messages);
      setMessagesPagination(data.pagination);
      setMessagesPage(1);
    } catch (e: any) {
      addToast('error', e.message || t('common.loadError'));
    }
  };

  // Silent refresh — only append new messages without resetting scroll
  const fetchMessagesSilent = async (convId: number) => {
    try {
      const data = await api.getConversation(convId, { page: 1, pageSize: 50 });
      // Only update if message count changed (avoid unnecessary re-renders)
      if (data.messages.length !== messages.length) {
        setMessages(data.messages);
        setMessagesPagination(data.pagination);
        // Re-mark as read since new messages arrived
        api.markConversationRead(convId).catch(() => {});
      }
    } catch { /* ignore */ }
  };

  const handleLoadMore = async () => {
    if (!selectedId || !messagesPagination || messagesPage >= messagesPagination.totalPages) return;
    setLoadingMore(true);
    try {
      const nextPage = messagesPage + 1;
      const data = await api.getConversation(selectedId, { page: nextPage, pageSize: 50 });
      // Append older messages to the end (messages are stored DESC, rendered reversed)
      setMessages([...data.messages, ...messages]);
      setMessagesPage(nextPage);
      setMessagesPagination(data.pagination);
    } catch (e: any) {
      addToast('error', e.message || t('common.loadError'));
    } finally {
      setLoadingMore(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim()) return;
    setSending(true);
    try {
      // If we have a selected conversation, send to that other user
      let convId = selectedId;
      if (targetUserId) {
        const result = await api.sendMessage(targetUserId, messageInput.trim());
        convId = result.conversation_id;
        setSelectedId(convId);
        setTargetUserId(null);
        navigate(`/messages/${convId}`);
        await fetchConversations();
      } else if (convId) {
        // Find the other user in conversations
        const conv = conversations.find((c) => c.id === convId);
        if (conv) {
          await api.sendMessage(conv.other_user_id, messageInput.trim());
        }
      }
      setMessageInput('');
      if (convId) await fetchMessages(convId);
      await fetchConversations();
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      setSending(false);
    }
  };

  // User search for new conversation dialog
  const handleUserSearch = async (query: string) => {
    setUserSearchQuery(query);
    if (!query.trim()) {
      setUserSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const data = await api.getUserList({ page: 1, pageSize: 10, search: query.trim() });
      // Exclude self
      setUserSearchResults((data.users || []).filter((u: any) => u.id !== user?.id));
    } catch {
      setUserSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleStartConversation = (targetUser: any) => {
    setTargetUserId(targetUser.id);
    setShowNewDialog(false);
    setUserSearchQuery('');
    setUserSearchResults([]);
    navigate(`/messages?target=${targetUser.id}`);
  };

  return (
    <div className="messages-page">
      <div className="messages-container">
        {/* 会话列表 */}
        <div className={`conversations-panel ${selectedId && conversations.length > 0 ? 'hidden-mobile' : ''}`}>
          <div className="panel-header">
            <h2><MessageSquare size={18} /> {t('messages.conversations')}</h2>
            <button
              className="btn-icon-sm new-conv-btn"
              onClick={() => setShowNewDialog(true)}
              title={t('messages.newConversation')}
            >
              <Plus size={16} />
            </button>
          </div>
          <div className="conversations-list">
            {loading ? (
              <div className="panel-empty">{t('common.loading')}</div>
            ) : conversations.length === 0 && !targetUserId ? (
              <div className="panel-empty">
                <MessageSquare size={36} />
                <p>{t('messages.noConversations')}</p>
              </div>
            ) : (
              conversations.map((c) => (
                <div
                  key={c.id}
                  className={`conversation-item ${selectedId === c.id ? 'active' : ''}`}
                  onClick={() => { setSelectedId(c.id); navigate(`/messages/${c.id}`); }}
                >
                  {c.other_avatar ? (
                    <img src={c.other_avatar} alt={c.other_username} className="conv-avatar" />
                  ) : (
                    <div className="conv-avatar placeholder">
                      {c.other_username?.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="conv-content">
                    <div className="conv-username">{c.other_username}</div>
                    <div className="conv-preview">{c.last_message || ''}</div>
                  </div>
                  {c.unread_count > 0 && <span className="unread-badge">{c.unread_count}</span>}
                </div>
              ))
            )}
          </div>
        </div>

        {/* 消息流 */}
        <div className={`messages-panel ${!selectedId && !targetUserId ? 'hidden-mobile' : ''}`}>
          {!selectedId && !targetUserId ? (
            <div className="panel-empty">
              <MessageSquare size={48} />
              <p>{t('messages.startConversation')}</p>
            </div>
          ) : (
            <>
              <div className="panel-header">
                <button className="btn-icon-sm back-btn-mobile" onClick={() => navigate('/messages')}>
                  <ArrowLeft size={16} />
                </button>
                <h2>{targetUserId ? t('messages.startConversation') : (conversations.find((c) => c.id === selectedId)?.other_username || '')}</h2>
              </div>
              <div className="messages-list">
                {messagesPagination && messagesPagination.totalPages > 1 && (
                  <button
                    className="load-more-btn"
                    onClick={handleLoadMore}
                    disabled={loadingMore || messagesPage >= messagesPagination.totalPages}
                  >
                    {loadingMore ? t('common.loading') : t('messages.loadMore')}
                  </button>
                )}
                {messages.length === 0 ? (
                  <div className="panel-empty">{t('messages.noMessages')}</div>
                ) : (
                  [...messages].reverse().map((m) => (
                    <div key={m.id} className={`message-row ${m.sender_id === user?.id ? 'own' : ''}`}>
                      <div className="message-bubble">
                        <div className="message-text">{m.content}</div>
                        <div className="message-time">{new Date(m.created_at).toLocaleString()}</div>
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>
              <form className="message-input-form" onSubmit={handleSendMessage}>
                <input
                  type="text"
                  placeholder={t('messages.messageInput')}
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  disabled={sending}
                />
                <button type="submit" className="btn btn-primary btn-sm" disabled={sending || !messageInput.trim()}>
                  <Send size={14} />
                  {sending ? t('messages.sending') : t('messages.send')}
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      {/* New conversation dialog */}
      {showNewDialog && (
        <div className="msg-modal-overlay" onClick={() => setShowNewDialog(false)}>
          <div className="msg-modal" onClick={(e) => e.stopPropagation()}>
            <div className="msg-modal-header">
              <h3>{t('messages.newConversation')}</h3>
              <button className="btn-icon-sm" onClick={() => setShowNewDialog(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="msg-modal-body">
              <div className="msg-search-box">
                <Search size={16} className="msg-search-icon" />
                <input
                  type="text"
                  placeholder={t('messages.searchUserPlaceholder')}
                  value={userSearchQuery}
                  onChange={(e) => handleUserSearch(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="msg-search-results">
                {searching ? (
                  <div className="msg-search-empty">{t('common.loading')}</div>
                ) : userSearchResults.length === 0 ? (
                  userSearchQuery.trim() ? (
                    <div className="msg-search-empty">{t('messages.noUsersFound')}</div>
                  ) : (
                    <div className="msg-search-empty">{t('messages.searchUserHint')}</div>
                  )
                ) : (
                  userSearchResults.map((u) => (
                    <div
                      key={u.id}
                      className="msg-user-item"
                      onClick={() => handleStartConversation(u)}
                    >
                      {u.avatar_url ? (
                        <img src={u.avatar_url} alt={u.username} className="msg-user-avatar" />
                      ) : (
                        <div className="msg-user-avatar placeholder">
                          {u.username?.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="msg-user-info">
                        <div className="msg-user-name">{u.username}</div>
                        {u.role && u.role !== 'user' && (
                          <span className="msg-user-role">{u.role}</span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
