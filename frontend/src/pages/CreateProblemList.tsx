import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import { BookOpen, ChevronRight, Plus, X } from 'lucide-react';
import { t } from '../i18n';
import './CreateProblemList.css';

export default function CreateProblemList() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Problem search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedProblems, setSelectedProblems] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (searchQuery.trim()) {
      const timer = setTimeout(async () => {
        setSearching(true);
        try {
          const data = await api.getProblems({ search: searchQuery, pageSize: 10 });
          setSearchResults(data.problems.filter((p: any) => !selectedProblems.find(sp => sp.id === p.id)));
        } catch (e) {
          console.error('Search failed:', e);
        } finally {
          setSearching(false);
        }
      }, 300);
      return () => clearTimeout(timer);
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearchResults([]);
    }
  }, [searchQuery, selectedProblems]);

  if (!user) {
    return (
      <div className="empty-container">
        <h2>{t('tickets.loginRequired')}</h2>
        <Link to="/login" className="btn btn-primary">{t('login.title')}</Link>
      </div>
    );
  }

  const addProblem = (problem: any) => {
    if (!selectedProblems.find(p => p.id === problem.id)) {
      setSelectedProblems([...selectedProblems, problem]);
      setSearchResults(searchResults.filter(p => p.id !== problem.id));
    }
  };

  const removeProblem = (problemId: number) => {
    setSelectedProblems(selectedProblems.filter(p => p.id !== problemId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const data = await api.createProblemList({
        title: title.trim(),
        description: description.trim(),
        is_public: isPublic ? 1 : 0,
        problems: selectedProblems.map((p) => ({ problem_id: p.id, note: '' })),
      });
      navigate(`/lists/${data.id}`);
    } catch (e: any) {
      setError(e.message || t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="create-list-page">
      <div className="breadcrumb">
        <Link to="/lists">{t('lists.title')}</Link>
        <ChevronRight size={14} />
        <span>{t('lists.createList')}</span>
      </div>

      <div className="create-list-card">
        <div className="create-list-header">
          <BookOpen size={22} className="list-icon" />
          <h1>{t('lists.createList')}</h1>
        </div>

        {error && <div className="form-error">{error}</div>}

        <form onSubmit={handleSubmit} className="list-form">
          <div className="form-group">
            <label>{t('lists.title')}</label>
            <input type="text" className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('lists.titlePlaceholder')} required maxLength={200} />
          </div>

          <div className="form-group">
            <label>{t('lists.description')}</label>
            <textarea className="form-textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('lists.descriptionPlaceholder')} rows={4} maxLength={5000} />
          </div>

          <div className="form-group">
            <label className="checkbox-label">
              <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
              {t('admin.public')}
            </label>
          </div>

          <div className="form-group">
            <label>{t('lists.addProblems')}</label>
            <input type="text" className="form-input" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={t('lists.searchProblems')} />
            {searching && <div style={{fontSize:'12px',color:'var(--text-muted)',marginTop:'4px'}}>{t('common.loading')}</div>}
            {searchResults.length > 0 && (
              <div className="problem-search-results">
                {searchResults.map((p) => (
                  <div key={p.id} className="problem-search-item" onClick={() => addProblem(p)}>
                    <span>#{p.id} {p.title}</span>
                    <Plus size={14} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {selectedProblems.length > 0 && (
            <div className="selected-problems">
              <label>{t('lists.selectedProblems')} ({selectedProblems.length})</label>
              <div className="selected-problems-list">
                {selectedProblems.map((p, idx) => (
                  <div key={p.id} className="selected-problem-item">
                    <span className="problem-order">{idx + 1}.</span>
                    <span className="problem-name">#{p.id} {p.title}</span>
                    <button type="button" className="remove-problem-btn" onClick={() => removeProblem(p.id)}>
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/lists')}>{t('common.cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={submitting || !title.trim()}>
              {submitting ? t('common.loading') : t('lists.createList')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
