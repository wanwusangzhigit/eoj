import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import { useToastStore } from '../store/toast';
import { useThemeStore } from '../store/theme';
import { renderMarkdown } from '../utils/markdown';
import { t } from '../i18n';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { Send, Trash2, Copy, Check, Bot, User, AlertCircle, Wrench, ChevronDown, ChevronUp } from 'lucide-react';
import './AIChat.css';

interface ToolCallEntry {
  name: string;
  arguments: any;
  result_summary: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  tool_calls?: ToolCallEntry[];
}

interface AiStatus {
  available: boolean;
  chat_enabled: boolean;
  completion_enabled: boolean;
  provider: string;
  model: string;
  allowed_models: { model: string; display_name: string }[];
}

export default function AIChat() {
  const { user } = useAuthStore();
  const { addToast } = useToastStore();
  const { theme } = useThemeStore();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useDocumentTitle(t('ai.title'));

  // Check AI availability on mount
  useEffect(() => {
    let cancelled = false;
    const checkStatus = async () => {
      setStatusLoading(true);
      setStatusError(false);
      try {
        const data = await api.aiStatus();
        if (!cancelled) {
          setStatus(data);
          // Default to first allowed model, or the configured default model
          if (data.allowed_models && data.allowed_models.length > 0) {
            setSelectedModel(data.allowed_models[0].model);
          } else if (data.model) {
            setSelectedModel(data.model);
          }
        }
      } catch (e) {
        if (!cancelled) {
          setStatusError(true);
        }
      } finally {
        if (!cancelled) {
          setStatusLoading(false);
        }
      }
    };
    checkStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-scroll to bottom on new messages / loading state
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading, scrollToBottom]);

  // Auto-resize textarea while typing
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 160) + 'px';
  };

  const resetTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    if (!status?.available) {
      addToast('error', t('ai.notAvailable'));
      return;
    }
    if (!status?.chat_enabled) {
      addToast('error', t('ai.chatDisabled'));
      return;
    }

    const userMessage: Message = { role: 'user', content: trimmed };
    const assistantMessage: Message = { role: 'assistant', content: '', tool_calls: [] };

    setMessages(prev => [...prev, userMessage, assistantMessage]);
    setInput('');
    resetTextareaHeight();
    setLoading(true);

    try {
      const chatMessages = [...messages, userMessage].map(m => ({ role: m.role, content: m.content }));

      for await (const event of api.aiChatStream(chatMessages, undefined, selectedModel || undefined)) {
        if (event.type === 'token') {
          setMessages(prev => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
              updated[lastIdx] = { ...updated[lastIdx], content: updated[lastIdx].content + event.data.content };
            }
            return updated;
          });
        } else if (event.type === 'tool_call') {
          setMessages(prev => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
              const tc = updated[lastIdx].tool_calls || [];
              updated[lastIdx] = {
                ...updated[lastIdx],
                tool_calls: [...tc, { name: event.data.name, arguments: event.data.arguments, result_summary: '' }],
              };
            }
            return updated;
          });
        } else if (event.type === 'tool_result') {
          setMessages(prev => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
              const tc = updated[lastIdx].tool_calls || [];
              let targetIdx = -1;
              for (let i = tc.length - 1; i >= 0; i--) {
                if (tc[i].name === event.data.name && !tc[i].result_summary) {
                  targetIdx = i;
                  break;
                }
              }
              if (targetIdx >= 0) {
                const newTc = [...tc];
                newTc[targetIdx] = { ...newTc[targetIdx], result_summary: event.data.result_summary };
                updated[lastIdx] = { ...updated[lastIdx], tool_calls: newTc };
              }
            }
            return updated;
          });
        } else if (event.type === 'done') {
          if (event.data.tool_calls && event.data.tool_calls.length > 0) {
            setMessages(prev => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
                updated[lastIdx] = { ...updated[lastIdx], tool_calls: event.data.tool_calls };
              }
              return updated;
            });
          }
        } else if (event.type === 'error') {
          addToast('error', event.data.message || t('ai.error'));
        }
      }
    } catch (e: any) {
      const message = e?.message || t('ai.error');
      addToast('error', message);
      setMessages(prev => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (lastIdx >= 0 && updated[lastIdx].role === 'assistant' && !updated[lastIdx].content) {
          updated.pop();
        }
        return updated;
      });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    if (messages.length === 0) return;
    if (!window.confirm(t('ai.clearChat') + '?')) return;
    setMessages([]);
    setCopiedIndex(null);
  };

  const handleCopy = async (content: string, index: number) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedIndex(index);
      addToast('success', t('ai.copied'));
      setTimeout(() => {
        setCopiedIndex((prev) => (prev === index ? null : prev));
      }, 2000);
    } catch {
      addToast('error', t('common.error'));
    }
  };

  const renderUserAvatar = () => {
    if (user?.avatar_url) {
      return (
        <img
          src={user.avatar_url}
          alt={user.username}
          className="ai-avatar-img"
        />
      );
    }
    return <User size={18} />;
  };

  const toolDisplayName = (name: string): string => {
    const map: Record<string, string> = {
      get_problem: t('ai.toolGetProblem'),
      list_problems: t('ai.toolListProblems'),
      list_my_submissions: t('ai.toolListSubmissions'),
      get_submission_detail: t('ai.toolGetSubmission'),
      get_sample_testcases: t('ai.toolGetTestcases'),
      get_problem_stats: t('ai.toolGetStats'),
    };
    return map[name] || name;
  };

  const toggleToolsExpanded = (idx: number) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleQuickPrompt = (prompt: string) => {
    setInput(prompt);
    textareaRef.current?.focus();
  };

  const isChatAvailable = !!status?.available && !!status?.chat_enabled;
  const canSend = input.trim().length > 0 && !loading && isChatAvailable;

  // Status loading state
  if (statusLoading) {
    return (
      <div className="ai-chat-page">
        <div className="ai-chat-loading">
          <div className="loading-spinner" />
          <p>{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  // Status fetch failed
  if (statusError || !status) {
    return (
      <div className="ai-chat-page">
        <div className="ai-chat-error-state">
          <AlertCircle size={40} className="ai-error-icon" />
          <p>{t('ai.notAvailable')}</p>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => window.location.reload()}
          >
            {t('common.retry')}
          </button>
        </div>
      </div>
    );
  }

  // AI not configured
  if (!status.available) {
    return (
      <div className="ai-chat-page">
        <div className="ai-chat-header">
          <div className="ai-chat-title-section">
            <Bot size={24} className="title-icon" />
            <h1 className="ai-chat-title">{t('ai.title')}</h1>
          </div>
        </div>
        <div className="ai-chat-unavailable">
          <AlertCircle size={40} className="ai-error-icon" />
          <p>{t('ai.notConfigured')}</p>
        </div>
      </div>
    );
  }

  // Chat feature disabled
  if (!status.chat_enabled) {
    return (
      <div className="ai-chat-page">
        <div className="ai-chat-header">
          <div className="ai-chat-title-section">
            <Bot size={24} className="title-icon" />
            <h1 className="ai-chat-title">{t('ai.title')}</h1>
          </div>
        </div>
        <div className="ai-chat-unavailable">
          <AlertCircle size={40} className="ai-error-icon" />
          <p>{t('ai.chatDisabled')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="ai-chat-page">
      <div className="ai-chat-header">
        <div className="ai-chat-title-section">
          <Bot size={24} className="title-icon" />
          <h1 className="ai-chat-title">{t('ai.title')}</h1>
          {status.allowed_models && status.allowed_models.length > 0 ? (
            <select
              className="ai-model-select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              title={t('ai.selectModel')}
            >
              {status.allowed_models.map((m) => (
                <option key={m.model} value={m.model}>{m.display_name}</option>
              ))}
            </select>
          ) : status.provider && status.model ? (
            <span className="ai-model-badge">
              {status.provider} · {status.model}
            </span>
          ) : null}
        </div>
        <button
          className="ai-clear-btn"
          onClick={handleClear}
          disabled={messages.length === 0}
          title={t('ai.clearChat')}
        >
          <Trash2 size={16} />
          <span>{t('ai.clearChat')}</span>
        </button>
      </div>

      <div className="ai-chat-messages">
        {messages.length === 0 ? (
          <div className="ai-welcome">
            <Bot size={48} className="ai-welcome-icon" />
            <p>{t('ai.welcome')}</p>
            <div className="ai-welcome-prompts">
              <button
                className="ai-prompt-chip"
                onClick={() => handleQuickPrompt(t('ai.promptSubmissions'))}
              >
                {t('ai.promptSubmissions')}
              </button>
              <button
                className="ai-prompt-chip"
                onClick={() => handleQuickPrompt(t('ai.promptAnalyze'))}
              >
                {t('ai.promptAnalyze')}
              </button>
              <button
                className="ai-prompt-chip"
                onClick={() => handleQuickPrompt(t('ai.promptRecommend'))}
              >
                {t('ai.promptRecommend')}
              </button>
              <button
                className="ai-prompt-chip"
                onClick={() => handleQuickPrompt(t('ai.promptProblem'))}
              >
                {t('ai.promptProblem')}
              </button>
            </div>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div key={idx} className={`ai-message ai-message-${msg.role}`}>
              <div className="ai-message-avatar">
                {msg.role === 'user' ? renderUserAvatar() : <Bot size={18} />}
              </div>
              <div className="ai-message-body">
                <div className="ai-message-header">
                  <span className="ai-message-author">
                    {msg.role === 'user' ? t('ai.you') : t('ai.assistant')}
                  </span>
                  {msg.role === 'assistant' && (
                    <button
                      className="ai-copy-btn"
                      onClick={() => handleCopy(msg.content, idx)}
                      title={copiedIndex === idx ? t('ai.copied') : t('ai.copy')}
                    >
                      {copiedIndex === idx ? (
                        <Check size={14} />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                  )}
                </div>
                {msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0 && (
                  <div className={`ai-tool-trace ${expandedTools.has(idx) ? 'expanded' : ''}`}>
                    <div
                      className="ai-tool-trace-header"
                      onClick={() => toggleToolsExpanded(idx)}
                    >
                      <Wrench size={13} />
                      <span>{t('ai.toolsUsed').replace('{0}', String(msg.tool_calls.length))}</span>
                      {expandedTools.has(idx) ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </div>
                    {expandedTools.has(idx) && (
                      <div className="ai-tool-trace-list">
                        {msg.tool_calls.map((tc, tcIdx) => (
                          <div key={tcIdx} className="ai-tool-trace-item">
                            <span className="ai-tool-name">{toolDisplayName(tc.name)}</span>
                            <span className="ai-tool-args">
                              {Object.keys(tc.arguments || {}).length > 0
                                ? JSON.stringify(tc.arguments)
                                : '—'}
                            </span>
                            <span className="ai-tool-result">{tc.result_summary}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="ai-message-content">
                  {msg.role === 'assistant' ? (
                    msg.content ? (
                      <div
                        className={`markdown-content ai-markdown markdown-theme-${theme}${loading && idx === messages.length - 1 ? ' ai-streaming' : ''}`}
                        data-code-theme={theme}
                        dangerouslySetInnerHTML={{
                          __html: renderMarkdown(msg.content),
                        }}
                      />
                    ) : loading && idx === messages.length - 1 ? (
                      <div className="ai-thinking">
                        <span className="ai-thinking-dot" />
                        <span className="ai-thinking-dot" />
                        <span className="ai-thinking-dot" />
                        <span className="ai-thinking-text">{t('ai.thinking')}</span>
                      </div>
                    ) : null
                  ) : (
                    <div className="ai-message-text">{msg.content}</div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="ai-chat-input">
        <textarea
          ref={textareaRef}
          className="ai-chat-textarea"
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={t('ai.placeholder')}
          rows={1}
          disabled={loading}
        />
        <button
          className="ai-send-btn"
          onClick={handleSend}
          disabled={!canSend}
        >
          <Send size={16} />
          <span>{loading ? t('ai.sending') : t('ai.send')}</span>
        </button>
      </div>
    </div>
  );
}
