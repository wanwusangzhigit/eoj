import { useState, useEffect } from 'react';
import { api } from '../../api/client';
import type { AIModelConfig } from '../../api/client';
import { useToastStore } from '../../store/toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { t } from '../../i18n';
import { Save, Plus, Trash2 } from 'lucide-react';
import '../Admin.css';

export default function AdminModels() {
  useDocumentTitle(t('admin.aiModels'));
  const [aiModels, setAiModels] = useState<AIModelConfig[]>([]);
  const [aiModelsLoading, setAiModelsLoading] = useState(false);
  const [aiModelsSaving, setAiModelsSaving] = useState(false);
  const [aiModelsLoaded, setAiModelsLoaded] = useState(false);

  useEffect(() => {
    if (!aiModelsLoaded) {
      fetchAIModels();
    }
  }, []);

  const fetchAIModels = async () => {
    setAiModelsLoading(true);
    try {
      const data = await api.getAIModels();
      setAiModels(data.models || []);
      setAiModelsLoaded(true);
    } catch (e: any) {
      useToastStore().addToast('error', e.message || t('common.error'));
    } finally {
      setAiModelsLoading(false);
    }
  };

  const handleSaveAIModels = async () => {
    setAiModelsSaving(true);
    try {
      const data = await api.updateAIModels(aiModels);
      setAiModels(data.models);
      useToastStore().addToast('success', t('admin.aiModelsSaved'));
    } catch (e: any) {
      useToastStore().addToast('error', e.message || t('common.error'));
    } finally {
      setAiModelsSaving(false);
    }
  };

  const addAIModel = () => {
    setAiModels([
      ...aiModels,
      {
        id: `model-${Date.now()}`,
        model: '',
        display_name: '',
        enabled: true,
        temperature: '',
        max_tokens: '',
      },
    ]);
  };

  const updateAIModel = (id: string, patch: Partial<AIModelConfig>) => {
    setAiModels(aiModels.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };

  const removeAIModel = (id: string) => {
    setAiModels(aiModels.filter((m) => m.id !== id));
  };

  return (
    <div className="admin-form">
      <h2>{t('admin.aiModels')}</h2>
      <p style={{fontSize:'13px',color:'var(--text-secondary)',marginBottom:'16px'}}>
        {t('admin.aiModelsHint')}
      </p>

      {aiModelsLoading ? (
        <p style={{color:'var(--text-secondary)'}}>{t('common.loading')}</p>
      ) : (
        <>
          <div className="ai-models-list">
            {aiModels.length === 0 && (
              <p style={{color:'var(--text-secondary)',padding:'12px 0'}}>
                {t('admin.aiModelsEmpty')}
              </p>
            )}
            {aiModels.map((m) => (
              <div key={m.id} className="ai-model-row">
                <div className="ai-model-row-field">
                  <label>{t('admin.aiModelId')}</label>
                  <input
                    type="text"
                    value={m.model}
                    onChange={(e) => updateAIModel(m.id, { model: e.target.value })}
                    placeholder="glm-4-flash"
                  />
                </div>
                <div className="ai-model-row-field">
                  <label>{t('admin.aiModelName')}</label>
                  <input
                    type="text"
                    value={m.display_name}
                    onChange={(e) => updateAIModel(m.id, { display_name: e.target.value })}
                    placeholder={t('admin.aiModelNamePlaceholder')}
                  />
                </div>
                <div className="ai-model-row-field ai-model-row-field-sm">
                  <label>{t('ai.aiTemperature')}</label>
                  <input
                    type="text"
                    value={m.temperature || ''}
                    onChange={(e) => updateAIModel(m.id, { temperature: e.target.value })}
                    placeholder={t('admin.aiModelUseGlobal')}
                  />
                </div>
                <div className="ai-model-row-field ai-model-row-field-sm">
                  <label>{t('ai.aiMaxTokens')}</label>
                  <input
                    type="text"
                    value={m.max_tokens || ''}
                    onChange={(e) => updateAIModel(m.id, { max_tokens: e.target.value })}
                    placeholder={t('admin.aiModelUseGlobal')}
                  />
                </div>
                <div className="ai-model-row-field ai-model-row-toggle">
                  <label>{t('common.status')}</label>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={m.enabled}
                      onChange={(e) => updateAIModel(m.id, { enabled: e.target.checked })}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => removeAIModel(m.id)}
                  title={t('common.delete')}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <div className="form-actions" style={{marginTop:'16px',gap:'8px'}}>
            <button
              className="btn btn-secondary"
              onClick={addAIModel}
              type="button"
            >
              <Plus size={16} /> {t('admin.aiModelAdd')}
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSaveAIModels}
              disabled={aiModelsSaving}
            >
              <Save size={16} />
              {aiModelsSaving ? t('admin.saving') : t('common.save')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
