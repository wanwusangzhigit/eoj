import { useState, useRef, useEffect } from 'react';
import { Smile } from 'lucide-react';
import { t } from '../i18n';
import './EmojiPicker.css';

interface EmojiPickerProps {
  onInsert: (text: string) => void;
}

// 常用表情
const EMOJIS = [
  '😀', '😂', '🤣', '😊', '😅', '😉', '🙂', '😍', '😘', '😜',
  '🤔', '😎', '🤩', '🥳', '😢', '😭', '😡', '😱', '🤯', '💪',
  '👍', '👎', '👏', '🙏', '👌', '✌️', '🤝', '❤️', '💯', '🔥',
  '⭐', '✨', '🎉', '🎯', '🚀', '✅', '❌', '⚠️', '💡', '📌',
];

// 常用 Markdown 片段
const SNIPPETS = [
  { label: '代码块', text: '\n```\n// code\n```\n' },
  { label: '行内代码', text: '`code`' },
  { label: '链接', text: '[text](https://)' },
  { label: '图片', text: '![alt](https://)' },
  { label: '加粗', text: '**bold**' },
  { label: '斜体', text: '*italic*' },
  { label: '引用', text: '\n> quote\n' },
  { label: '列表', text: '\n- item\n' },
];

export default function EmojiPicker({ onInsert }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'emoji' | 'snippet'>('emoji');
  const ref = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const insert = (text: string) => {
    onInsert(text);
    setOpen(false);
  };

  return (
    <div className="emoji-picker-wrap" ref={ref}>
      <button
        type="button"
        className="emoji-picker-toggle"
        title={t('emojiPicker.title')}
        onClick={() => setOpen((v) => !v)}
      >
        <Smile size={16} />
      </button>
      {open && (
        <div className="emoji-picker-panel">
          <div className="emoji-picker-tabs">
            <button className={tab === 'emoji' ? 'active' : ''} onClick={() => setTab('emoji')}>{t('emojiPicker.emoji')}</button>
            <button className={tab === 'snippet' ? 'active' : ''} onClick={() => setTab('snippet')}>{t('emojiPicker.snippet')}</button>
          </div>
          {tab === 'emoji' ? (
            <div className="emoji-grid">
              {EMOJIS.map((e) => (
                <button key={e} type="button" className="emoji-item" onClick={() => insert(e)}>{e}</button>
              ))}
            </div>
          ) : (
            <div className="snippet-list">
              {SNIPPETS.map((s) => (
                <button key={s.label} type="button" className="snippet-item" onClick={() => insert(s.text)}>{s.label}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
