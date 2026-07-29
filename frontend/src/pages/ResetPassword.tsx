import { useState } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { Lock, CheckCircle, AlertCircle, Loader2, ArrowLeft } from 'lucide-react';
import './Login.css';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-header">
            <AlertCircle size={32} />
            <h1>无效的链接</h1>
          </div>
          <p className="login-description">密码重置链接无效，请重新申请。</p>
          <div className="login-actions" style={{ marginTop: 20 }}>
            <Link to="/forgot-password" className="btn btn-primary">
              重新申请
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('密码长度至少 8 个字符');
      return;
    }
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    setLoading(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (e: any) {
      setError(e.message || '重置失败，链接可能已过期');
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-header">
            <CheckCircle size={48} className="login-success-icon" />
            <h1>密码已重置</h1>
          </div>
          <p className="login-description">您的密码已成功重置，请使用新密码登录。</p>
          <div className="login-actions" style={{ marginTop: 20 }}>
            <button className="btn btn-primary" onClick={() => navigate('/login')}>
              前往登录
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <Lock size={32} />
          <h1>设置新密码</h1>
        </div>
        <p className="login-description">请输入您的新密码。</p>

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label>新密码</label>
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 8 个字符"
              required
              minLength={8}
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>确认新密码</label>
            <input
              type="password"
              className="form-input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="再次输入新密码"
              required
            />
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? <Loader2 size={16} className="spin" /> : <Lock size={16} />}
            {loading ? '重置中...' : '重置密码'}
          </button>
        </form>

        <div className="login-footer">
          <Link to="/login" className="login-footer-link">
            <ArrowLeft size={14} />
            返回登录
          </Link>
        </div>
      </div>
    </div>
  );
}
