import { useRef } from 'react';
import { Bold, Italic, Heading2, Code, Code2, Link, Image, List, ListOrdered, Quote } from 'lucide-react';
import { t } from '../i18n';
import './MarkdownToolbar.css';

interface MarkdownToolbarProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (value: string) => void;
}

interface ToolAction {
  key: string;
  icon: React.ReactNode;
  label: string;
  // wrap: 选中文本被包裹;prefix/suffix: 直接插入前后缀
  prefix: string;
  suffix?: string;
  placeholder?: string; // 无选中文本时的占位内容
  block?: boolean; // 块级(前后换行)
}

const TOOLS: ToolAction[] = [
  { key: 'bold', icon: <Bold size={14} />, label: 'mdToolbar.bold', prefix: '**', suffix: '**', placeholder: '粗体文本' },
  { key: 'italic', icon: <Italic size={14} />, label: 'mdToolbar.italic', prefix: '*', suffix: '*', placeholder: '斜体文本' },
  { key: 'heading', icon: <Heading2 size={14} />, label: 'mdToolbar.heading', prefix: '## ', placeholder: '标题' },
  { key: 'code', icon: <Code2 size={14} />, label: 'mdToolbar.code', prefix: '`', suffix: '`', placeholder: '行内代码' },
  { key: 'codeblock', icon: <Code size={14} />, label: 'mdToolbar.codeblock', prefix: '\n```\n', suffix: '\n```\n', placeholder: '代码块', block: true },
  { key: 'link', icon: <Link size={14} />, label: 'mdToolbar.link', prefix: '[', suffix: '](https://)', placeholder: '链接文字' },
  { key: 'image', icon: <Image size={14} />, label: 'mdToolbar.image', prefix: '![', suffix: '](https://)', placeholder: '图片描述' },
  { key: 'ul', icon: <List size={14} />, label: 'mdToolbar.ul', prefix: '\n- ', placeholder: '列表项', block: true },
  { key: 'ol', icon: <ListOrdered size={14} />, label: 'mdToolbar.ol', prefix: '\n1. ', placeholder: '列表项', block: true },
  { key: 'quote', icon: <Quote size={14} />, label: 'mdToolbar.quote', prefix: '\n> ', placeholder: '引用内容', block: true },
];

export default function MarkdownToolbar({ textareaRef, value, onChange }: MarkdownToolbarProps) {
  const lastFocusRef = useRef<number | null>(null);

  const applyAction = (tool: ToolAction) => {
    const el = textareaRef.current;
    if (!el) return;

    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const selected = value.slice(start, end);
    const insertText = selected ? `${tool.prefix}${selected}${tool.suffix || ''}` : `${tool.prefix}${tool.placeholder || ''}${tool.suffix || ''}`;

    const next = value.slice(0, start) + insertText + value.slice(end);
    onChange(next);

    // 恢复光标到插入内容之后,并重新聚焦
    const newPos = start + insertText.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(newPos, newPos);
      lastFocusRef.current = newPos;
    });
  };

  return (
    <div className="md-toolbar">
      {TOOLS.map((tool) => (
        <button
          key={tool.key}
          type="button"
          className="md-toolbar-btn"
          title={t(tool.label)}
          aria-label={t(tool.label)}
          onMouseDown={(e) => e.preventDefault()} // 防止 textarea 失焦
          onClick={() => applyAction(tool)}
        >
          {tool.icon}
        </button>
      ))}
    </div>
  );
}
