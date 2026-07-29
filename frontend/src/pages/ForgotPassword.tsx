import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Mail, ArrowLeft, CheckCircle, Loader2 } from 'lucide-react';
import './Login.css';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError('请输入邮箱地址');
      return;
    }
    setLoading(true);
    try {
      await api.forgotPassword(email.trim());
      setSent(true);
    } catch (e: any) {
      setError(e.message || '发送失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-header">
            <CheckCircle size={48} className="login-success-icon" />
            <h1>重置邮件已发送</h1>
          </div>
          <p className="login-description">
            如果该邮箱已注册，您将收到一封包含密码重置链接的邮件。
            <br />
            链接有效期为 1 小时。
          </p>
          <div className="login-actions" style={{ marginTop: 20 }}>
            <Link to="/login" className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <ArrowLeft size={16} />
              返回登录
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <Mail size={32} />
          <h1>忘记密码</h1>
        </div>
        <p className="login-description">输入注册时使用的邮箱地址，我们将发送重置链接。</p>

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label>邮箱地址</label>
            <input
              type="email"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              autoFocus
            />
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? <Loader2 size={16} className="spin" /> : <Mail size={16} />}
            {loading ? '发送中...' : '发送重置链接'}
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
