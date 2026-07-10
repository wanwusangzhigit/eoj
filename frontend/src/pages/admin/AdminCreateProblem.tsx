import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useToastStore } from '../../store/toast';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { DIFFICULTIES } from '../../constants';
import { t } from '../../i18n';
import { Save } from 'lucide-react';
import '../Admin.css';

export default function AdminCreateProblem() {
  useDocumentTitle(t('admin.createProblem'));
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [problemForm, setProblemForm] = useState({
    title: '',
    slug: '',
    description: '',
    input_format: '',
    output_format: '',
    time_limit: 1000,
    memory_limit: 256,
    tags: [] as string[],
    difficulty: 'Easy',
    is_public: true,
    judge_type: 'default' as 'default' | 'spj',
    spj_language: 'cpp' as string,
  });

  const [spjCode, setSpjCode] = useState('');
  const [tagInput, setTagInput] = useState('');

  const handleAddTag = () => {
    if (tagInput.trim() && !problemForm.tags.includes(tagInput.trim())) {
      setProblemForm({ ...problemForm, tags: [...problemForm.tags, tagInput.trim()] });
      setTagInput('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    setProblemForm({ ...problemForm, tags: problemForm.tags.filter((t) => t !== tag) });
  };

  const handleCreateProblem = async () => {
    if (!problemForm.title || !problemForm.slug || !problemForm.description) {
      useToastStore().addToast('error', t('admin.titleRequired'));
      return;
    }
    setSaving(true);
    try {
      const data: any = { ...problemForm };
      if (problemForm.judge_type === 'spj') {
        data.spj_code = spjCode;
      }
      const result = await api.createProblem(data);
      useToastStore().addToast('success', t('admin.problemCreated'));
      navigate(`/admin/testcases?problemId=${result.id}&problemTitle=${encodeURIComponent(problemForm.title)}&problemSlug=${encodeURIComponent(problemForm.slug)}&problemDifficulty=${problemForm.difficulty}&problemJudgeType=${problemForm.judge_type}`);
    } catch (e: any) {
      useToastStore().addToast('error', e.message || t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-form">
      <div className="form-group">
        <label>{t('admin.problemTitle')}</label>
        <input
          type="text"
          value={problemForm.title}
          onChange={(e) => setProblemForm({ ...problemForm, title: e.target.value })}
          placeholder={t('admin.problemTitlePlaceholder')}
        />
      </div>
      <div className="form-group">
        <label>{t('admin.slug')}</label>
        <input
          type="text"
          value={problemForm.slug}
          onChange={(e) => setProblemForm({ ...problemForm, slug: e.target.value })}
          placeholder={t('admin.slugPlaceholder')}
        />
      </div>
      <div className="form-group">
        <label>{t('admin.description')}</label>
        <textarea
          rows={8}
          value={problemForm.description}
          onChange={(e) => setProblemForm({ ...problemForm, description: e.target.value })}
          placeholder={t('admin.descriptionPlaceholder')}
        />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>{t('admin.inputFormat')}</label>
          <textarea
            rows={3}
            value={problemForm.input_format}
            onChange={(e) => setProblemForm({ ...problemForm, input_format: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label>{t('admin.outputFormat')}</label>
          <textarea
            rows={3}
            value={problemForm.output_format}
            onChange={(e) => setProblemForm({ ...problemForm, output_format: e.target.value })}
          />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>{t('admin.timeLimit')}</label>
          <input
            type="number"
            value={problemForm.time_limit}
            onChange={(e) => setProblemForm({ ...problemForm, time_limit: parseInt(e.target.value) })}
          />
        </div>
        <div className="form-group">
          <label>{t('admin.memoryLimit')}</label>
          <input
            type="number"
            value={problemForm.memory_limit}
            onChange={(e) => setProblemForm({ ...problemForm, memory_limit: parseInt(e.target.value) })}
          />
        </div>
      </div>
      <div className="form-group">
        <label>{t('admin.difficulty')}</label>
        <select
          value={problemForm.difficulty || 'Easy'}
          onChange={(e) => setProblemForm({ ...problemForm, difficulty: e.target.value })}
        >
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label>{t('admin.judgeType')}</label>
        <select
          value={problemForm.judge_type}
          onChange={(e) => setProblemForm({ ...problemForm, judge_type: e.target.value as 'default' | 'spj' })}
        >
          <option value="default">{t('admin.defaultJudge')}</option>
          <option value="spj">{t('admin.specialJudge')}</option>
        </select>
      </div>
      {problemForm.judge_type === 'spj' && (
        <>
          <div className="form-group">
            <label>{t('admin.spjLanguage')}</label>
            <select
              value={problemForm.spj_language}
              onChange={(e) => setProblemForm({ ...problemForm, spj_language: e.target.value })}
            >
              <option value="cpp">C++</option>
              <option value="c">C</option>
              <option value="python">Python</option>
              <option value="java">Java</option>
              <option value="javascript">JavaScript</option>
              <option value="go">Go</option>
              <option value="rust">Rust</option>
            </select>
          </div>
          <div className="form-group">
            <label>{t('admin.spjCode')}</label>
            <textarea
              rows={15}
              value={spjCode}
              onChange={(e) => setSpjCode(e.target.value)}
              placeholder={t('admin.spjHint')}
              style={{ fontFamily: 'monospace', fontSize: '13px' }}
            />
            <small style={{ color: 'var(--text-secondary)', marginTop: '4px', display: 'block' }}>
              {t('admin.spjHint')}
            </small>
          </div>
        </>
      )}
      <div className="form-group">
        <label>{t('admin.tags')}</label>
        <div className="tag-input-row">
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
            placeholder={t('admin.tagPlaceholder')}
          />
          <button className="btn btn-secondary btn-sm" onClick={handleAddTag}>{t('common.add')}</button>
        </div>
        <div className="tag-list">
          {problemForm.tags.map((tag) => (
            <span key={tag} className="tag-chip active" onClick={() => handleRemoveTag(tag)}>
              {tag} ×
            </span>
          ))}
        </div>
      </div>
      <div className="form-group">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={problemForm.is_public}
            onChange={(e) => setProblemForm({ ...problemForm, is_public: e.target.checked })}
          />
          {t('admin.public')}
        </label>
      </div>
      <button
        className="btn btn-primary"
        onClick={handleCreateProblem}
        disabled={saving}
      >
        <Save size={16} />
        {saving ? t('admin.creating') : t('admin.createProblemButton')}
      </button>
    </div>
  );
}
