import { useState, useEffect, useCallback } from 'react';
import { Clock, Type } from 'lucide-react';
import { t } from '../i18n';
import './ReadingProgress.css';

interface ReadingProgressProps {
  containerRef: React.RefObject<HTMLElement | null>;
}

// 估算字数与阅读时间(中文约 400 字/分,英文约 200 词/分)
function estimate(content: string) {
  if (!content) return { chars: 0, minutes: 0 };
  const cjk = (content.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const words = (content.match(/[a-zA-Z0-9]+/g) || []).length;
  const chars = cjk + words;
  const minutes = Math.max(1, Math.ceil(cjk / 400 + words / 200));
  return { chars, minutes };
}

export default function ReadingProgress({ containerRef }: ReadingProgressProps) {
  const [progress, setProgress] = useState(0);
  const [meta, setMeta] = useState<{ chars: number; minutes: number } | null>(null);

  // 统计字数与阅读时间
  const computeMeta = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setMeta(estimate(el.textContent || ''));
  }, [containerRef]);

  useEffect(() => {
    const timer = setTimeout(computeMeta, 200);
    return () => clearTimeout(timer);
  }, [computeMeta]);

  // 滚动进度条
  useEffect(() => {
    const onScroll = () => {
      const el = containerRef.current;
      if (!el) return;
      const total = Math.max(1, el.offsetTop + el.offsetHeight - window.innerHeight);
      const pct = Math.min(100, Math.max(0, ((window.scrollY - el.offsetTop) / total) * 100));
      setProgress(pct);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [containerRef]);

  return (
    <div className="reading-progress">
      <div className="reading-progress-track">
        <div className="reading-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      {meta && (
        <div className="reading-progress-meta">
          <span title={t('readingProgress.words')}>
            <Type size={12} /> {meta.chars.toLocaleString()}
          </span>
          <span title={t('readingProgress.minutes')}>
            <Clock size={12} /> {t('readingProgress.readTime').replace('{0}', String(meta.minutes))}
          </span>
        </div>
      )}
    </div>
  );
}
