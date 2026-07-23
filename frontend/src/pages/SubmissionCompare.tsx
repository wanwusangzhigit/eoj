import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/auth';
import LoadingSpinner from '../components/LoadingSpinner';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { useThemeStore } from '../store/theme';
import { ArrowLeft, Code2 } from 'lucide-react';

const getLangExtension = (lang: string) => {
  switch (lang) {
    case 'python': return python();
    case 'cpp': case 'c': return cpp();
    case 'java': return java();
    case 'javascript': return javascript();
    default: return python();
  }
};

export default function SubmissionCompare() {
  const { id1, id2 } = useParams<{ id1: string; id2: string }>();
  const { user } = useAuthStore();
  const { theme } = useThemeStore();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id1 || !id2) return;
    setLoading(true);
    api.compareSubmissions(parseInt(id1), parseInt(id2))
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id1, id2]);

  if (!user) return <div className="empty-state"><p>请先登录</p></div>;
  if (loading) return <LoadingSpinner />;
  if (!data) return <div className="empty-state"><p>无法加载提交记录</p></div>;

  const { submission_a: a, submission_b: b } = data;

  return (
    <div className="submission-compare-page" style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>
      <Link to="/submissions" className="back-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
        <ArrowLeft size={16} /> 返回提交列表
      </Link>

      <h1 style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Code2 size={24} />
        提交对比 #{a.id} vs #{b.id}
      </h1>

      <div className="compare-info" style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
        <div className="card" style={{ flex: 1, padding: 16 }}>
          <h3>提交 #{a.id}</h3>
          <p>用户: {a.username}</p>
          <p>题目: {a.problem_title}</p>
          <p>语言: {a.language}</p>
          <p>状态: {a.status}</p>
          <p>分数: {a.score || 0}</p>
          <p>时间: {new Date(a.created_at).toLocaleString()}</p>
        </div>
        <div className="card" style={{ flex: 1, padding: 16 }}>
          <h3>提交 #{b.id}</h3>
          <p>用户: {b.username}</p>
          <p>题目: {b.problem_title}</p>
          <p>语言: {b.language}</p>
          <p>状态: {b.status}</p>
          <p>分数: {b.score || 0}</p>
          <p>时间: {new Date(b.created_at).toLocaleString()}</p>
        </div>
      </div>

      <div className="compare-code" style={{ display: 'flex', gap: 16 }}>
        <div className="compare-code-panel" style={{ flex: 1 }}>
          <h3 style={{ marginBottom: 8 }}>#{a.id} 代码</h3>
          <CodeMirror
            value={a.source_code}
            height="500px"
            theme={theme === 'dark' ? oneDark : undefined}
            extensions={[getLangExtension(a.language)]}
            readOnly={true}
            basicSetup={{ lineNumbers: true, foldGutter: false }}
          />
        </div>
        <div className="compare-code-panel" style={{ flex: 1 }}>
          <h3 style={{ marginBottom: 8 }}>#{b.id} 代码</h3>
          <CodeMirror
            value={b.source_code}
            height="500px"
            theme={theme === 'dark' ? oneDark : undefined}
            extensions={[getLangExtension(b.language)]}
            readOnly={true}
            basicSetup={{ lineNumbers: true, foldGutter: false }}
          />
        </div>
      </div>
    </div>
  );
}