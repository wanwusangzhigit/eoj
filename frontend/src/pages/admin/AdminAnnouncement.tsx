import { useState, useEffect, useCallback } from 'react';
import DOMPurify from 'dompurify';
import { api } from '../../api/client';
import { useToastStore } from '../../store/toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { t } from '../../i18n';
import { Save, Send } from 'lucide-react';
import '../Admin.css';

export default function AdminAnnouncement() {
  useDocumentTitle(t('admin.announcementManagement'));
  const addToast = useToastStore((s) => s.addToast);
  const [announcementContent, setAnnouncementContent] = useState('');
  const [announcementSaving, setAnnouncementSaving] = useState(false);
  const [announcementLoaded, setAnnouncementLoaded] = useState(false);

  // 系统公告群发(站内通知)
  const [sysTitle, setSysTitle] = useState('');
  const [sysContent, setSysContent] = useState('');
  const [sysLink, setSysLink] = useState('');
  const [sysSending, setSysSending] = useState(false);
  const [sysResult, setSysResult] = useState('');

  const fetchAnnouncement = useCallback(async () => {
    try {
      const data = await api.getSettings();
      setAnnouncementContent(data.announcement || '');
      setAnnouncementLoaded(true);
    } catch (e) {
      console.error('Failed to fetch announcement:', e);
    }
  }, []);

  useEffect(() => {
    if (!announcementLoaded) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchAnnouncement();
    }
  }, [fetchAnnouncement, announcementLoaded]);

  const handleSaveAnnouncement = async () => {
    setAnnouncementSaving(true);
    try {
      await api.updateSettings({ announcement: announcementContent });
      addToast('success', t('admin.announcementSaved'));
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      setAnnouncementSaving(false);
    }
  };

  const handleSendSystemAnnouncement = async () => {
    if (!sysTitle.trim() || !sysContent.trim()) {
      addToast('error', t('admin.sysAnnouncementRequired'));
      return;
    }
    setSysSending(true);
    setSysResult('');
    try {
      const data = await api.sendSystemAnnouncement(sysTitle.trim(), sysContent.trim(), sysLink.trim() || undefined);
      setSysResult(t('admin.sysAnnouncementSent').replace('{0}', String(data.sent)));
      setSysTitle('');
      setSysContent('');
      setSysLink('');
      addToast('success', t('admin.sysAnnouncementSent').replace('{0}', String(data.sent)));
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      setSysSending(false);
    }
  };

  return (
    <div className="admin-form">
      <h2>{t('admin.announcementManagement')}</h2>
      <p style={{fontSize:'13px',color:'var(--text-secondary)',marginBottom:'16px'}}>
        {t('admin.announcementHint')}
      </p>
      <div className="form-group">
        <label>{t('admin.announcementContent')}</label>
        <textarea
          rows={8}
          value={announcementContent}
          onChange={(e) => setAnnouncementContent(e.target.value)}
          placeholder={t('admin.announcementPlaceholder')}
          style={{ fontFamily: 'monospace', fontSize: '13px' }}
        />
      </div>
      {announcementContent && (
        <div className="form-group">
          <label>{t('admin.announcementPreview')}</label>
          <div
            className="announcement-preview"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(announcementContent) }}
          />
        </div>
      )}
      <div className="form-actions">
        <button
          className="btn btn-primary"
          onClick={handleSaveAnnouncement}
          disabled={announcementSaving}
        >
          <Save size={16} />
          {announcementSaving ? t('admin.saving') : t('common.save')}
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => setAnnouncementContent('')}
        >
          {t('admin.announcementClear')}
        </button>
      </div>

      <hr style={{ margin: '24px 0', border: 'none', borderTop: '1px solid var(--border-color)' }} />

      <h3 style={{ marginBottom: 8 }}>
        <Send size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
        {t('admin.sysAnnouncementTitle')}
      </h3>
      <p style={{fontSize:'13px',color:'var(--text-secondary)',marginBottom:'16px'}}>
        {t('admin.sysAnnouncementHint')}
      </p>
      <div className="form-group">
        <label>{t('admin.sysAnnouncementSubject')}</label>
        <input
          type="text"
          value={sysTitle}
          onChange={(e) => setSysTitle(e.target.value)}
          maxLength={200}
          placeholder={t('admin.sysAnnouncementSubjectPlaceholder')}
        />
      </div>
      <div className="form-group">
        <label>{t('admin.sysAnnouncementBody')}</label>
        <textarea
          rows={5}
          value={sysContent}
          onChange={(e) => setSysContent(e.target.value)}
          maxLength={5000}
          placeholder={t('admin.sysAnnouncementBodyPlaceholder')}
        />
      </div>
      <div className="form-group">
        <label>{t('admin.sysAnnouncementLink')}</label>
        <input
          type="text"
          value={sysLink}
          onChange={(e) => setSysLink(e.target.value)}
          maxLength={500}
          placeholder="https://..."
        />
      </div>
      <div className="form-actions">
        <button
          className="btn btn-primary"
          onClick={handleSendSystemAnnouncement}
          disabled={sysSending}
        >
          <Send size={16} />
          {sysSending ? t('admin.sysAnnouncementSending') : t('admin.sysAnnouncementSend')}
        </button>
        {sysResult && (
          <span style={{ color: 'var(--success)', fontSize: 13 }}>{sysResult}</span>
        )}
      </div>
    </div>
  );
}
