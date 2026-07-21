import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { ArrowLeft, Users, Info } from 'lucide-react';
import { t } from '../i18n';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToastStore } from '../store/toast';
import './Teams.css';

export default function CreateTeam() {
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const [form, setForm] = useState({
    name: '',
    slug: '',
    description: '',
    avatar_url: '',
    is_public: true,
    join_method: 'free',
  });
  const [submitting, setSubmitting] = useState(false);
  useDocumentTitle(t('teams.createTeam'));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.slug.trim()) {
      addToast('error', t('teams.teamName'));
      return;
    }
    setSubmitting(true);
    try {
      await api.createTeam(form);
      addToast('success', t('teams.teamCreated'));
      navigate(`/teams/${form.slug}`);
    } catch (e: any) {
      addToast('error', e.message || t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="create-team-page">
      <button className="btn btn-secondary btn-sm" onClick={() => navigate('/teams')}>
        <ArrowLeft size={14} />
        {t('teams.backToTeams')}
      </button>
      <h1>
        <Users size={24} />
        {t('teams.createTeam')}
      </h1>
      <form className="create-team-form" onSubmit={handleSubmit}>
        <div className="card" style={{ padding: 24 }}>
          <div className="form-group">
            <label>{t('teams.teamName')} <span style={{ color: 'var(--error)' }}>*</span></label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t('teams.teamName')}
              required
            />
          </div>

          <div className="form-group">
            <label>{t('teams.teamSlug')} <span style={{ color: 'var(--error)' }}>*</span></label>
            <input
              type="text"
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
              placeholder="my-team"
              pattern="[a-z0-9-]+"
              required
            />
            <span className="hint">{t('teams.teamSlug')}: lowercase letters, numbers, hyphens</span>
          </div>

          <div className="form-group">
            <label>{t('teams.teamDescription')}</label>
            <textarea
              rows={4}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder={t('teams.teamDescription')}
            />
          </div>

          <div className="form-group">
            <label>{t('teams.teamAvatar')}</label>
            <input
              type="text"
              value={form.avatar_url}
              onChange={(e) => setForm({ ...form, avatar_url: e.target.value })}
              placeholder="https://example.com/avatar.png"
            />
          </div>

          <div className="form-group">
            <label>{t('teams.joinMethod')}</label>
            <select
              value={form.join_method}
              onChange={(e) => setForm({ ...form, join_method: e.target.value })}
            >
              <option value="free">{t('teams.joinMethodFree')}</option>
              <option value="approval">{t('teams.joinMethodApproval')}</option>
              <option value="invite">{t('teams.joinMethodInvite')}</option>
            </select>
            <span className="hint" style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
              <Info size={12} />
              {form.join_method === 'free' ? t('teams.joinMethodFree') :
               form.join_method === 'approval' ? t('teams.joinMethodApproval') :
               t('teams.joinMethodInvite')}
            </span>
          </div>

          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.is_public}
                onChange={(e) => setForm({ ...form, is_public: e.target.checked })}
              />
              <span>{t('teams.isPublic')}</span>
            </label>
          </div>

          <div className="form-actions" style={{ marginTop: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? t('common.submitting') : t('common.submit')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/teams')}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}