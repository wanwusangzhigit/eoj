import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { useToastStore } from '../store/toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { Code2, Trash2, Save, Edit3 } from 'lucide-react';
import '../pages/Admin.css';

const LANGUAGES = [
  { value: 'python', label: 'Python 3' },
  { value: 'cpp', label: 'C++' },
  { value: 'java', label: 'Java' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'c', label: 'C' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
];

export default function Templates() {
  useDocumentTitle('代码模板管理');
  const addToast = useToastStore((s) => s.addToast);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editLang, setEditLang] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editName, setEditName] = useState('');

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getTemplates();
      setTemplates(data.templates || []);
    } catch { setTemplates([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTemplates();
  }, [fetchTemplates]);

  const handleSave = async () => {
    if (!editLang || !editContent) return;
    try {
      await api.saveTemplate(editLang, editContent, editName);
      addToast('success', '模板已保存');
      setEditLang(''); setEditContent(''); setEditName('');
      fetchTemplates();
    } catch (e: any) { addToast('error', e.message || '保存失败'); }
  };

  const handleDelete = async (lang: string) => {
    if (!confirm('确定删除此模板？')) return;
    try {
      await api.deleteTemplate(lang);
      addToast('success', '模板已删除');
      fetchTemplates();
    } catch (e: any) { addToast('error', e.message || '删除失败'); }
  };

  const startEdit = async (lang: string) => {
    try {
      const data = await api.getTemplate(lang);
      if (data.template) {
        setEditLang(lang);
        setEditContent(data.template.content || '');
        setEditName(data.template.name || '');
      }
    } catch { addToast('error', '获取模板失败'); }
  };

  return (
    <div className="admin-page" style={{ maxWidth: 800, margin: '0 auto' }}>
      <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Code2 size={24} /> 代码模板管理
      </h1>

      <div className="admin-form" style={{ marginTop: 20 }}>
        <div className="form-group">
          <label>语言</label>
          <select value={editLang} onChange={(e) => { setEditLang(e.target.value); if (e.target.value) startEdit(e.target.value); }}>
            <option value="">选择语言...</option>
            {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </div>
        {editLang && (
          <>
            <div className="form-group">
              <label>模板名称（可选）</label>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="My Template" />
            </div>
            <div className="form-group">
              <label>代码内容</label>
              <textarea rows={15} value={editContent} onChange={(e) => setEditContent(e.target.value)} style={{ fontFamily: 'monospace', fontSize: 13 }} />
            </div>
            <button className="btn btn-primary" onClick={handleSave} disabled={!editContent.trim()}>
              <Save size={14} /> 保存模板
            </button>
          </>
        )}
      </div>

      <h3 style={{ marginTop: 30, marginBottom: 12 }}>已保存的模板</h3>
      {loading ? (
        <div className="loading-container"><div className="loading-spinner" /></div>
      ) : templates.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>暂无模板，请先选择一个语言创建。</p>
      ) : (
        <div className="table-wrapper">
          <table className="admin-table">
            <thead>
              <tr><th>语言</th><th>名称</th><th>更新时间</th><th>操作</th></tr>
            </thead>
            <tbody>
              {templates.map((tpl: any) => (
                <tr key={tpl.language}>
                  <td><span className="tag-chip">{tpl.language}</span></td>
                  <td>{tpl.name || '-'}</td>
                  <td className="cell-value">{tpl.updated_at ? new Date(tpl.updated_at + 'Z').toLocaleString() : '-'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => startEdit(tpl.language)}>
                        <Edit3 size={12} /> 编辑
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(tpl.language)}>
                        <Trash2 size={12} /> 删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
