import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import { useToastStore } from '../store/toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { Save, Settings, Bell, Code2 } from 'lucide-react';

export default function UserSettings() {
  const { user } = useAuthStore();
  const addToast = useToastStore((s) => s.addToast);
  useDocumentTitle('用户设置');
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notifyPrefs, setNotifyPrefs] = useState<Record<string, string>>({});
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedLang, setSelectedLang] = useState('python');
  const [templateContent, setTemplateContent] = useState('');

  useEffect(() => {
    fetchSettings();
    fetchNotifyPrefs();
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    try {
      const data = await api.getTemplates();
      setTemplates(data.templates || []);
      // Set initial content for selected language
      const tpl = data.templates?.find((t: any) => t.language === selectedLang);
      setTemplateContent(tpl?.content || '');
    } catch {
      // ignore
    }
  };

  const handleSaveTemplate = async () => {
    try {
      await api.saveTemplate(selectedLang, templateContent, `${selectedLang} template`);
      addToast('success', '模板已保存');
      fetchTemplates();
    } catch (e: any) {
      addToast('error', e.message || '保存失败');
    }
  };

  const handleLangChange = (lang: string) => {
    setSelectedLang(lang);
    const tpl = templates.find((t: any) => t.language === lang);
    setTemplateContent(tpl?.content || '');
  };

  const fetchNotifyPrefs = async () => {
    try {
      const data = await api.getNotificationPreferences();
      setNotifyPrefs(data.preferences || {});
    } catch {
      // ignore
    }
  };

  const fetchSettings = async () => {
    try {
      const data = await api.getUserSettings();
      setSettings(data.settings || {});
    } catch {
      // ignore
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.saveUserSettings(settings);
      addToast('success', '设置已保存');
    } catch (e: any) {
      addToast('error', e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return <div className="empty-state"><p>请先登录</p></div>;
  }

  return (
    <div className="settings-page" style={{ maxWidth: 600, margin: '0 auto', padding: 24 }}>
      <h1 style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <Settings size={24} />
        用户设置
      </h1>

      <div className="card" style={{ padding: 20 }}>
        <div className="form-group">
          <label>代码编辑器主题</label>
          <select
            className="form-input form-select"
            value={settings.editor_theme || 'dark'}
            onChange={(e) => setSettings({ ...settings, editor_theme: e.target.value })}
          >
            <option value="dark">深色</option>
            <option value="light">浅色</option>
          </select>
        </div>

        <div className="form-group">
          <label>默认代码语言</label>
          <select
            className="form-input form-select"
            value={settings.default_language || 'python'}
            onChange={(e) => setSettings({ ...settings, default_language: e.target.value })}
          >
            <option value="python">Python 3</option>
            <option value="cpp">C++</option>
            <option value="java">Java</option>
            <option value="javascript">JavaScript</option>
            <option value="c">C</option>
            <option value="go">Go</option>
            <option value="rust">Rust</option>
          </select>
        </div>

        <div className="form-group">
          <label>每页显示条目数</label>
          <select
            className="form-input form-select"
            value={settings.page_size || '20'}
            onChange={(e) => setSettings({ ...settings, page_size: e.target.value })}
          >
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>

        <div className="form-actions">
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            <Save size={14} />
            {saving ? '保存中...' : '保存设置'}
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginTop: 16 }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Bell size={18} /> 通知偏好
        </h3>
        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={notifyPrefs.notify_contest !== 'false'}
              onChange={(e) => setNotifyPrefs({ ...notifyPrefs, notify_contest: e.target.checked ? 'true' : 'false' })}
            />
            <span>比赛提醒</span>
          </label>
        </div>
        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={notifyPrefs.notify_message !== 'false'}
              onChange={(e) => setNotifyPrefs({ ...notifyPrefs, notify_message: e.target.checked ? 'true' : 'false' })}
            />
            <span>私信通知</span>
          </label>
        </div>
        <div className="form-group">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={notifyPrefs.notify_follow !== 'false'}
              onChange={(e) => setNotifyPrefs({ ...notifyPrefs, notify_follow: e.target.checked ? 'true' : 'false' })}
            />
            <span>关注通知</span>
          </label>
        </div>
        <div className="form-actions">
          <button className="btn btn-primary btn-sm" onClick={async () => {
            try {
              await api.saveNotificationPreferences(notifyPrefs);
              addToast('success', '通知偏好已保存');
            } catch (e: any) {
              addToast('error', e.message || '保存失败');
            }
          }}>
            <Save size={14} /> 保存通知偏好
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginTop: 16 }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Code2 size={18} /> 代码模板
        </h3>
        <div className="form-group">
          <label>选择语言</label>
          <select className="form-input form-select" value={selectedLang} onChange={(e) => handleLangChange(e.target.value)}>
            <option value="python">Python 3</option>
            <option value="cpp">C++</option>
            <option value="java">Java</option>
            <option value="javascript">JavaScript</option>
            <option value="c">C</option>
            <option value="go">Go</option>
            <option value="rust">Rust</option>
          </select>
        </div>
        <div className="form-group">
          <label>模板代码</label>
          <textarea
            className="form-input"
            rows={12}
            value={templateContent}
            onChange={(e) => setTemplateContent(e.target.value)}
            style={{ fontFamily: 'monospace', fontSize: '13px' }}
          />
        </div>
        <div className="form-actions">
          <button className="btn btn-primary btn-sm" onClick={handleSaveTemplate}>
            <Save size={14} /> 保存模板
          </button>
        </div>
      </div>
    </div>
  );
}