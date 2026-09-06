import { useState, useEffect, useCallback } from 'react';
import { ListTree } from 'lucide-react';
import { t } from '../i18n';
import './ArticleToc.css';

interface TocItem {
  level: number; // 1-6
  text: string;
  el: HTMLElement;
}

interface ArticleTocProps {
  containerRef: React.RefObject<HTMLElement | null>;
}

export default function ArticleToc({ containerRef }: ArticleTocProps) {
  const [items, setItems] = useState<TocItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [visible, setVisible] = useState(true);

  // 扫描容器内的标题元素构建目录
  const scan = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const headings = Array.from(el.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'));
    if (headings.length < 2) {
      setItems([]);
      return;
    }
    setItems(headings.map((h) => ({
      level: parseInt(h.tagName[1], 10),
      text: h.textContent?.trim() || '',
      el: h,
    })).filter((it) => it.text));
  }, [containerRef]);

  useEffect(() => {
    // 内容变化后(博客加载完成)扫描;延迟确保 DOM 已渲染
    const timer = setTimeout(scan, 200);
    return () => clearTimeout(timer);
  }, [scan]);

  // 滚动监听:高亮当前所在标题
  useEffect(() => {
    if (items.length === 0) return;
    const onScroll = () => {
      const pos = window.scrollY + 90;
      let idx = -1;
      for (let i = 0; i < items.length; i++) {
        if (items[i].el.offsetTop <= pos) idx = i;
      }
      setActiveIndex(idx);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [items]);

  const jumpTo = (item: TocItem) => {
    item.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveIndex(items.indexOf(item));
  };

  if (items.length === 0) return null;

  return (
    <nav className={`article-toc ${visible ? '' : 'collapsed'}`}>
      <div className="article-toc-header">
        <ListTree size={14} />
        <span>{t('articleToc.title')}</span>
        <button
          type="button"
          className="article-toc-toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={t('articleToc.toggle')}
        >
          {visible ? '−' : '+'}
        </button>
      </div>
      <ul className="article-toc-list">
        {items.map((item, i) => (
          <li
            key={i}
            className={`article-toc-item level-${item.level} ${i === activeIndex ? 'active' : ''}`}
            style={{ paddingLeft: (item.level - 1) * 12 + 4 }}
          >
            <button type="button" onClick={() => jumpTo(item)} title={item.text}>
              {item.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
