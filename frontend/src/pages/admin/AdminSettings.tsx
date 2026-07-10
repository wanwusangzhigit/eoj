import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useToastStore } from '../../store/toast';
import { useSettingsStore } from '../../store/settings';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { t } from '../../i18n';
import { Save, Bot } from 'lucide-react';
import '../Admin.css';

export default function AdminSettings() {
  useDocumentTitle(t('admin.siteSettings'));
  const [settingsRegistrationOpen, setSettingsRegistrationOpen] = useState(true);
  const [settingsEmailRequired, setSettingsEmailRequired] = useState(false);
  const [settingsEmailSuffixes, setSettingsEmailSuffixes] = useState('');
  const [settingsUploadEnabled, setSettingsUploadEnabled] = useState(true);
  const [settingsImageUploadEnabled, setSettingsImageUploadEnabled] = useState(true);
  const [settingsAIEnabled, setSettingsAIEnabled] = useState(false);
  const [settingsAIChatEnabled, setSettingsAIChatEnabled] = useState(true);
  const [settingsAICompletionEnabled, setSettingsAICompletionEnabled] = useState(true);
  const [settingsAIProvider, setSettingsAIProvider] = useState('openai');
  const [settingsAIApiKey, setSettingsAIApiKey] = useState('');
  const [settingsAIBaseUrl, setSettingsAIBaseUrl] = useState('');
  const [settingsAIModel, setSettingsAIModel] = useState('');
  const [settingsAISystemPrompt, setSettingsAISystemPrompt] = useState('');
  const [settingsAIMaxTokens, setSettingsAIMaxTokens] = useState('4096');
  const [settingsAITemperature, setSettingsAITemperature] = useState('0.7');
  const [settingsAIAllowedModels, setSettingsAIAllowedModels] = useState('');
  const [settingsOAuthProtocol, setSettingsOAuthProtocol] = useState('');
  const [settingsOAuthCallbackUrl, setSettingsOAuthCallbackUrl] = useState('');
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const fetchSettings = useSettingsStore((s) => s.fetchSettings);

  useEffect(() => {
    if (!settingsLoaded) {
      fetchSiteSettings();
    }
  }, []);

  const fetchSiteSettings = async () => {
    try {
      const data = await api.getSettings();
      setSettingsRegistrationOpen(data.registration_open !== 'false');
      setSettingsEmailRequired(data.email_required === 'true');
      setSettingsEmailSuffixes(data.email_suffixes || '');
      setSettingsUploadEnabled(data.upload_enabled !== 'false');
      setSettingsImageUploadEnabled(data.image_upload_enabled !== 'false');
      setSettingsAIEnabled(data.ai_enabled === 'true');
      setSettingsAIChatEnabled(data.ai_chat_enabled !== 'false');
      setSettingsAICompletionEnabled(data.ai_completion_enabled !== 'false');
      setSettingsAIProvider(data.ai_provider || 'openai');
      setSettingsAIApiKey(data.ai_api_key || '');
      setSettingsAIBaseUrl(data.ai_base_url || '');
      setSettingsAIModel(data.ai_model || '');
      setSettingsAISystemPrompt(data.ai_system_prompt || '');
      setSettingsAIMaxTokens(data.ai_max_tokens || '4096');
      setSettingsAITemperature(data.ai_temperature || '0.7');
      setSettingsAIAllowedModels(data.ai_allowed_models || '');
      setSettingsOAuthProtocol(data.oauth_protocol || '');
      setSettingsOAuthCallbackUrl(data.oauth_callback_url || '');
      setSettingsLoaded(true);
    } catch (e) {
      console.error('Failed to fetch site settings:', e);
    }
  };

  const handleSaveSettings = async () => {
    setSettingsSaving(true);
    try {
      await api.updateSettings({
        registration_open: String(settingsRegistrationOpen),
        email_required: String(settingsEmailRequired),
        email_suffixes: settingsEmailSuffixes,
        upload_enabled: String(settingsUploadEnabled),
        image_upload_enabled: String(settingsImageUploadEnabled),
        ai_enabled: String(settingsAIEnabled),
        ai_chat_enabled: String(settingsAIChatEnabled),
        ai_completion_enabled: String(settingsAICompletionEnabled),
        ai_provider: settingsAIProvider,
        ai_api_key: settingsAIApiKey,
        ai_base_url: settingsAIBaseUrl,
        ai_model: settingsAIModel,
        ai_system_prompt: settingsAISystemPrompt,
        ai_max_tokens: settingsAIMaxTokens,
        ai_temperature: settingsAITemperature,
        ai_allowed_models: settingsAIAllowedModels,
        oauth_protocol: settingsOAuthProtocol,
        oauth_callback_url: settingsOAuthCallbackUrl,
      });
      await fetchSettings(true);
      useToastStore().addToast('success', t('admin.settingsSaved'));
    } catch (e: any) {
      useToastStore().addToast('error', e.message || t('common.error'));
    } finally {
      setSettingsSaving(false);
    }
  };

  return (
    <div className="admin-form">
      <h2>{t('admin.siteSettings')}</h2>

      <div className="form-group">
        <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer'}}>
          <input
            type="checkbox"
            checked={settingsRegistrationOpen}
            onChange={(e) => setSettingsRegistrationOpen(e.target.checked)}
          />
          {t('admin.registrationOpen')}
        </label>
        <p style={{fontSize:'13px',color:'var(--text-secondary)',marginTop:'4px'}}>
          {t('admin.registrationOpenHint')}
        </p>
      </div>

      <div className="form-group">
        <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer'}}>
          <input
            type="checkbox"
            checked={settingsEmailRequired}
            onChange={(e) => setSettingsEmailRequired(e.target.checked)}
          />
          {t('admin.emailRequired')}
        </label>
        <p style={{fontSize:'13px',color:'var(--text-secondary)',marginTop:'4px'}}>
          {t('admin.emailRequiredHint')}
        </p>
      </div>

      <div className="form-group">
        <label>{t('admin.emailSuffixes')}</label>
        <input
          type="text"
          value={settingsEmailSuffixes}
          onChange={(e) => setSettingsEmailSuffixes(e.target.value)}
          placeholder={t('admin.emailSuffixesPlaceholder')}
        />
        <p style={{fontSize:'13px',color:'var(--text-secondary)',marginTop:'4px'}}>
          {t('admin.emailSuffixesHint')}
        </p>
      </div>

      <div className="form-group">
        <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer'}}>
          <input
            type="checkbox"
            checked={settingsImageUploadEnabled}
            onChange={(e) => setSettingsImageUploadEnabled(e.target.checked)}
          />
          {t('common.imageUploadEnabled')}
        </label>
        <p style={{fontSize:'13px',color:'var(--text-secondary)',marginTop:'4px'}}>
          {t('common.imageUploadEnabledHint')}
        </p>
      </div>

      <div className="form-group">
        <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer'}}>
          <input
            type="checkbox"
            checked={settingsUploadEnabled}
            onChange={(e) => setSettingsUploadEnabled(e.target.checked)}
          />
          {t('common.uploadEnabled')}
        </label>
        <p style={{fontSize:'13px',color:'var(--text-secondary)',marginTop:'4px'}}>
          {t('common.uploadEnabledHint')}
        </p>
      </div>

      {/* AI Settings */}
      <div style={{marginTop: '24px', paddingTop: '24px', borderTop: '1px solid var(--border-color)'}}>
        <h3 style={{marginBottom: '12px'}}>{t('ai.aiSettings')}</h3>

        <div className="form-group">
          <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer'}}>
            <input
              type="checkbox"
              checked={settingsAIEnabled}
              onChange={(e) => setSettingsAIEnabled(e.target.checked)}
            />
            {t('ai.aiEnabled')}
          </label>
          <p style={{fontSize:'13px',color:'var(--text-secondary)',marginTop:'4px'}}>
            {t('ai.aiEnabledHint')}
          </p>
        </div>

        <div className="form-group">
          <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer'}}>
            <input
              type="checkbox"
              checked={settingsAIChatEnabled}
              onChange={(e) => setSettingsAIChatEnabled(e.target.checked)}
            />
            {t('ai.aiChatEnabled')}
          </label>
          <p style={{fontSize:'13px',color:'var(--text-secondary)',marginTop:'4px'}}>
            {t('ai.aiChatEnabledHint')}
          </p>
        </div>

        <div className="form-group">
          <label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer'}}>
            <input
              type="checkbox"
              checked={settingsAICompletionEnabled}
              onChange={(e) => setSettingsAICompletionEnabled(e.target.checked)}
            />
            {t('ai.aiCompletionEnabled')}
          </label>
          <p style={{fontSize:'13px',color:'var(--text-secondary)',marginTop:'4px'}}>
            {t('ai.aiCompletionEnabledHint')}
          </p>
        </div>

        <div className="form-group">
          <label>{t('ai.aiProvider')}</label>
          <select
            className="form-select"
            value={settingsAIProvider}
            onChange={(e) => setSettingsAIProvider(e.target.value)}
          >
            <option value="openai">{t('ai.aiProviderOpenai')}</option>
            <option value="anthropic">{t('ai.aiProviderAnthropic')}</option>
          </select>
          <p style={{fontSize:'13px',color:'var(--text-secondary)',marginTop:'4px'}}>
            {t('ai.aiProviderHint')}
          </p>
          <div style={{display:'flex',gap:'8px',flexWrap:'wrap',marginTop:'8px'}}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => {
              setSettingsAIProvider('openai');
              setSettingsAIBaseUrl('https://open.bigmodel.cn/api/paas/v4');
              setSettingsAIModel('glm-4-flash');
            }}>{t('ai.presetZhipu')}</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => {
              setSettingsAIProvider('openai');
              setSettingsAIBaseUrl('https://dashscope.aliyuncs.com/compatible-mode/v1');
              setSettingsAIModel('qwen-plus');
            }}>{t('ai.presetAliyun')}</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => {
              setSettingsAIProvider('openai');
              setSettingsAIBaseUrl('https://api.moonshot.cn/v1');
              setSettingsAIModel('moonshot-v1-8k');
            }}>{t('ai.presetMoonshot')}</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => {
              setSettingsAIProvider('openai');
              setSettingsAIBaseUrl('https://api.deepseek.com/v1');
              setSettingsAIModel('deepseek-chat');
            }}>{t('ai.presetDeepseek')}</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => {
              setSettingsAIProvider('openai');
              setSettingsAIBaseUrl('');
              setSettingsAIModel('gpt-4o');
            }}>{t('ai.presetOpenai')}</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => {
              setSettingsAIProvider('anthropic');
              setSettingsAIBaseUrl('');
              setSettingsAIModel('claude-sonnet-4-20250514');
            }}>{t('ai.presetAnthropic')}</button>
          </div>
        </div>

        <div className="form-group">
          <label>{t('ai.aiApiKey')}</label>
          <input
            type="password"
            value={settingsAIApiKey}
            onChange={(e) => setSettingsAIApiKey(e.target.value)}
            placeholder="sk-..."
            autoComplete="off"
          />
          <p style={{fontSize:'13px',color:'var(--text-secondary)',marginTop:'4px'}}>
            {t('ai.aiApiKeyHint')}
          </p>
        </div>

        <div className="form-group">
          <label>{t('ai.aiBaseUrl')}</label>
          <input
            type="text"
            value={settingsAIBaseUrl}
            onChange={(e) => setSettingsAIBaseUrl(e.target.value)}
            placeholder={settingsAIProvider === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1'}
          />
          <p style={{fontSize:'13px',color:'var(--text-secondary)',marginTop:'4px'}}>
            {t('ai.aiBaseUrlHint')}
          </p>
        </div>

        <div className="form-group">
          <label>{t('ai.aiModel')}</label>
          <input
            type="text"
            value={settingsAIModel}
            onChange={(e) => setSettingsAIModel(e.target.value)}
            placeholder="gpt-4o"
          />
          <p style={{fontSize:'13px',color:'var(--text-secondary)',marginTop:'4px'}}>
            {t('ai.aiModelHint')}
          </p>
        </div>

        <div className="form-group">
          <label>{t('ai.aiSystemPrompt')}</label>
          <textarea
            className="form-textarea"
            value={settingsAISystemPrompt}
            onChange={(e) => setSettingsAISystemPrompt(e.target.value)}
            placeholder="You are a helpful programming assistant..."
            rows={3}
          />
          <p style={{fontSize:'13px',color:'var(--text-secondary)',marginTop:'4px'}}>
            {t('ai.aiSystemPromptHint')}
          </p>
        </div>

        <div className="form-group">
          <label>{t('ai.aiMaxTokens')}</label>
          <input
            type="text"
            value={settingsAIMaxTokens}
            onChange={(e) => setSettingsAIMaxTokens(e.target.value)}
            placeholder="4096"
          />
          <p style={{fontSize:'13px',color:'var(--text-secondary)',marginTop:'4px'}}>
            {t('ai.aiMaxTokensHint')}
          </p>
        </div>

        <div className="form-group">
          <label>{t('ai.aiTemperature')}</label>
          <input
            type="text"
            value={settingsAITemperature}
            onChange={(e) => setSettingsAITemperature(e.target.value)}
            placeholder="0.7"
          />
          <p style={{fontSize:'13px',color:'var(--text-secondary)',marginTop:'4px'}}>
            {t('ai.aiTemperatureHint')}
          </p>
        </div>

        <div className="form-group">
          <label>{t('ai.aiAllowedModels')}</label>
          <Link
            to="/admin/models"
            className="btn btn-secondary btn-sm"
          >
            <Bot size={14} /> {t('admin.aiModelsManage')}
          </Link>
          <p style={{fontSize:'13px',color:'var(--text-secondary)',marginTop:'4px'}}>
            {t('ai.aiAllowedModelsHint')}
          </p>
        </div>
      </div>

      <div style={{marginTop: '24px', paddingTop: '24px', borderTop: '1px solid var(--border-color)'}}>
        <h3 style={{marginBottom: '12px'}}>{t('admin.oauthSettings')}</h3>

        <div className="form-group">
          <label>{t('admin.oauthProtocol')}</label>
          <select
            className="form-select"
            value={settingsOAuthProtocol}
            onChange={(e) => setSettingsOAuthProtocol(e.target.value)}
          >
            <option value="">{t('admin.oauthProtocolAuto')}</option>
            <option value="https:">{t('admin.oauthProtocolHttps')}</option>
            <option value="http:">{t('admin.oauthProtocolHttp')}</option>
          </select>
          <p style={{fontSize:'13px',color:'var(--text-secondary)',marginTop:'4px'}}>
            {t('admin.oauthProtocolHint')}
          </p>
        </div>

        <div className="form-group">
          <label>{t('admin.oauthCallbackUrl')}</label>
          <input
            type="text"
            value={settingsOAuthCallbackUrl}
            onChange={(e) => setSettingsOAuthCallbackUrl(e.target.value)}
            placeholder="https://your-domain.com"
          />
          <p style={{fontSize:'13px',color:'var(--text-secondary)',marginTop:'4px'}}>
            {t('admin.oauthCallbackUrlHint')}
          </p>
        </div>
      </div>

      <div className="form-actions">
        <button
          className="btn btn-primary"
          onClick={handleSaveSettings}
          disabled={settingsSaving}
        >
          <Save size={16} />
          {settingsSaving ? t('admin.saving') : t('common.save')}
        </button>
      </div>
    </div>
  );
}
