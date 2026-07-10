import { useEffect, useRef } from 'react';
import { useSettingsStore } from '../store/settings';
import './AdSlot.css';

const DEFAULT_CLIENT_ID = '';

interface AdSlotProps {
  position: string;
  format?: string;
  className?: string;
}

let adsenseScriptLoaded = false;

function ensureAdsenseScript(clientId: string) {
  if (adsenseScriptLoaded) return;
  if (!clientId) return;
  // index.html 中已预加载 script，检测到则直接标记
  const existing = document.getElementById('adsbygoogle-js');
  if (existing) {
    adsenseScriptLoaded = true;
    return;
  }
  const s = document.createElement('script');
  s.id = 'adsbygoogle-js';
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${clientId}`;
  document.head.appendChild(s);
  adsenseScriptLoaded = true;
}

export default function AdSlot({ position, format = 'auto', className }: AdSlotProps) {
  const settings = useSettingsStore((s) => s.settings);
  const insRef = useRef<HTMLModElement>(null);

  // 优先使用管理面板配置的 client ID，否则回退到硬编码默认值
  const clientId = settings.ads_client_id || DEFAULT_CLIENT_ID;
  const globalEnabled = settings.ads_enabled === 'true';
  const slot = settings[`ads_slot_${position}`] || '';
  const slotEnabled = settings[`ads_slot_${position}_enabled`] !== 'false';

  useEffect(() => {
    if (!globalEnabled || !clientId || !slot || !slotEnabled) return;
    ensureAdsenseScript(clientId);
    try {
      // @ts-ignore
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch { /* ignore */ }
  }, [globalEnabled, clientId, slot, slotEnabled]);

  if (!globalEnabled || !clientId || !slot || !slotEnabled) return null;

  return (
    <div className={`ad-slot ad-slot-${position}${className ? ` ${className}` : ''}`}>
      <ins
        ref={insRef}
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client={clientId}
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
    </div>
  );
}
