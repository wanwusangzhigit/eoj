import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import { useToastStore } from '../../store/toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { t } from '../../i18n';
import { Save } from 'lucide-react';
import '../Admin.css';

export default function AdminAnnouncement() {
  useDocumentTitle(t('admin.announcementManagement'));
  const addToast = useToastStore((s) => s.addToast);
  const [announcementContent, setAnnouncementContent] = useState('');
  const [announcementSaving, setAnnouncementSaving] = useState(false);
  const [announcementLoaded, setAnnouncementLoaded] = useState(false);

  useEffect(() => {
    if (!announcementLoaded) {
      fetchAnnouncement();
    }
  }, []);

  const fetchAnnouncement = async () => {
    try {
      const data = await api.getSettings();
      setAnnouncementContent(data.announcement || '');
      setAnnouncementLoaded(true);
    } catch (e) {
      console.error('Failed to fetch announcement:', e);
    }
  };

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
            dangerouslySetInnerHTML={{ __html: announcementContent }}
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
    </div>
  );
}
