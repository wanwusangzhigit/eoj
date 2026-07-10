import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { ArrowLeft } from 'lucide-react';
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
      <h1 style={{ marginTop: 16 }}>{t('teams.createTeam')}</h1>
      <form className="create-team-form" onSubmit={handleSubmit}>
        <label>
          <span>{t('teams.teamName')} *</span>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </label>
        <label>
          <span>{t('teams.teamSlug')} *</span>
          <input
            type="text"
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })}
            placeholder="my-team"
            pattern="[a-z0-9-]+"
            required
          />
        </label>
        <label>
          <span>{t('teams.teamDescription')}</span>
          <textarea
            rows={4}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        <label>
          <span>{t('teams.teamAvatar')} (URL)</span>
          <input
            type="text"
            value={form.avatar_url}
            onChange={(e) => setForm({ ...form, avatar_url: e.target.value })}
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={form.is_public}
            onChange={(e) => setForm({ ...form, is_public: e.target.checked })}
          />
          <span>{t('teams.isPublic')}</span>
        </label>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? t('common.submitting') : t('common.submit')}
        </button>
      </form>
    </div>
  );
}
