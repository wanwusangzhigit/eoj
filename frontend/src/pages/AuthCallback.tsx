import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { t } from '../i18n';
import './AuthCallback.css';

const errorKeyMap: Record<string, string> = {
  missing_code: 'authCallback.missingCode',
  state_mismatch: 'authCallback.stateMismatch',
  token_failed: 'authCallback.tokenFailed',
  userinfo_failed: 'authCallback.userinfoFailed',
  access_denied: 'authCallback.accessDenied',
  username_conflict: 'authCallback.usernameConflict',
};

export default function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setToken, fetchUser } = useAuthStore();
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  // OAuth 成功流程:后端把 JWT 存在服务端,只把一次性 exchange code 放在 ?code=
  // 前端调用 POST /api/v1/auth/exchange 拿 JWT,避免 token 出现在 URL fragment
  // 而被 Referer / 浏览器历史 / 共享设备泄漏。
  const exchangeCode = searchParams.get('code');
  const oauthError = searchParams.get('error');
  const errorDesc = searchParams.get('error_description');

  // Derive error from URL params during render
  const urlError = oauthError
    ? (errorKeyMap[oauthError] ? t(errorKeyMap[oauthError]) : (errorDesc || oauthError))
    : (!exchangeCode ? t('authCallback.authFailed') : null);
  const error = runtimeError || urlError;

  useEffect(() => {
    if (!exchangeCode || oauthError) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/v1/auth/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: exchangeCode }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!data?.success || !data?.data?.token) {
          setRuntimeError(t('authCallback.authFailed'));
          return;
        }
        setToken(data.data.token);
        await fetchUser();
        if (cancelled) return;
        navigate('/', { replace: true });
      } catch {
        if (!cancelled) setRuntimeError(t('authCallback.authFailed'));
      }
    })();
    return () => { cancelled = true; };
  }, [exchangeCode, oauthError, setToken, fetchUser, navigate]);

  if (error) {
    return (
      <div className="auth-callback-page">
        <div className="auth-callback-card">
          <div className="auth-callback-icon">✕</div>
          <h2>{t('authCallback.authFailed')}</h2>
          <p className="auth-callback-error">{error}</p>
          <Link to="/login" className="btn btn-primary">{t('authCallback.backToLogin')}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-callback-page" aria-live="polite">
      <div className="auth-callback-card">
        <div className="auth-callback-spinner" />
        <p>{t('authCallback.authenticating')}</p>
      </div>
    </div>
  );
}
