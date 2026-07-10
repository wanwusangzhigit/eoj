import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useSettingsStore } from '../../store/settings';
import { t } from '../../i18n';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { Megaphone, Save, Loader2 } from 'lucide-react';
import '../Admin.css';

interface SlotDef {
  key: string;
  label: string;
  hint: string;
}

const SLOT_DEFS: SlotDef[] = [
  { key: 'home_top', label: 'home_top', hint: 'home_top_hint' },
  { key: 'home_side', label: 'home_side', hint: 'home_side_hint' },
  { key: 'problem_side', label: 'problem_side', hint: 'problem_side_hint' },
  { key: 'blog_top', label: 'blog_top', hint: 'blog_top_hint' },
  { key: 'blog_side', label: 'blog_side', hint: 'blog_side_hint' },
];

export default function AdminAds() {
  useDocumentTitle(t('admin.adsManagement'));
  const fetchSettings = useSettingsStore((s) => s.fetchSettings);
  const [clientId, setClientId] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [slots, setSlots] = useState<Record<string, { slot: string; enabled: boolean }>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.getSettings();
        setClientId(data.ads_client_id || '');
        setEnabled(data.ads_enabled === 'true');
        const next: Record<string, { slot: string; enabled: boolean }> = {};
        for (const def of SLOT_DEFS) {
          next[def.key] = {
            slot: data[`ads_slot_${def.key}`] || '',
            enabled: data[`ads_slot_${def.key}_enabled`] !== 'false',
          };
        }
        setSlots(next);
      } catch {
        setMessage({ type: 'error', text: t('common.loadError') });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    setMessage(null);
    if (enabled && !clientId.trim()) {
      setMessage({ type: 'error', text: t('admin.adsClientIdRequired') });
      return;
    }
    if (clientId.trim() && !/^ca-pub-\d+$/.test(clientId.trim())) {
      setMessage({ type: 'error', text: t('admin.adsClientIdInvalid') });
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, string> = {
        ads_client_id: clientId.trim(),
        ads_enabled: enabled ? 'true' : 'false',
      };
      for (const def of SLOT_DEFS) {
        const s = slots[def.key];
        payload[`ads_slot_${def.key}`] = (s?.slot || '').trim();
        payload[`ads_slot_${def.key}_enabled`] = s?.enabled ? 'true' : 'false';
      }
      await api.updateSettings(payload);
      await fetchSettings(true);
      setMessage({ type: 'success', text: t('admin.adsSaved') });
    } catch {
      setMessage({ type: 'error', text: t('common.error') });
    } finally {
      setSaving(false);
    }
  };

  const updateSlot = (key: string, patch: Partial<{ slot: string; enabled: boolean }>) => {
    setSlots((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  if (loading) {
    return (
      <div className="admin-page">
        <div className="loading-container"><div className="loading-spinner"></div></div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <h1>{t('admin.adsManagement')}</h1>
      <p className="ads-intro">{t('admin.adsIntro')}</p>

      {message && (
        <div className={`message ${message.type}`}>{message.text}</div>
      )}

      <div className="admin-form">
        <div className="ads-global-row">
          <label className="checkbox-label">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span>{t('admin.adsEnabled')}</span>
          </label>
        </div>

        <div className="form-group">
          <label>{t('admin.adsClientId')}</label>
          <input
            type="text"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder=""
          />
          <span className="form-hint">{t('admin.adsClientIdHint')}</span>
        </div>

        <h3 className="ads-section-title">{t('admin.adsSlotsTitle')}</h3>
        <p className="ads-section-hint">{t('admin.adsSlotsHint')}</p>

        <div className="ads-slots-list">
          {SLOT_DEFS.map((def) => {
            const s = slots[def.key] || { slot: '', enabled: true };
            return (
              <div className="ads-slot-row" key={def.key}>
                <div className="ads-slot-head">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={s.enabled}
                      onChange={(e) => updateSlot(def.key, { enabled: e.target.checked })}
                    />
                    <strong>{def.label}</strong>
                  </label>
                  <span className="ads-slot-hint">{t(`admin.${def.hint}`)}</span>
                </div>
                <div className="form-group">
                  <label>{t('admin.adsSlotId')}</label>
                  <input
                    type="text"
                    value={s.slot}
                    onChange={(e) => updateSlot(def.key, { slot: e.target.value })}
                    placeholder="1234567890"
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="form-actions">
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
            {saving ? t('admin.saving') : t('common.save')}
          </button>
        </div>
      </div>

      <div className="ads-help">
        <Megaphone size={18} />
        <div>
          <strong>{t('admin.adsHelpTitle')}</strong>
          <ol>
            <li>{t('admin.adsHelpStep1')}</li>
            <li>{t('admin.adsHelpStep2')}</li>
            <li>{t('admin.adsHelpStep3')}</li>
            <li>{t('admin.adsHelpStep4')}</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
