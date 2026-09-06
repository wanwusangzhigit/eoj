import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { api } from '../api/client';
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
  const { fetchUser } = useAuthStore();
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  // OAuth 成功流程:后端把 JWT 存在服务端,只把一次性 exchange code 放在 ?code=
  // 前端调用 POST /api/v1/auth/exchange 拿 JWT,后端同时 Set-Cookie 写入 httpOnly cookie,
  // 客户端不再需要持有 token 字符串(SSR 时代由 cookie 自动携带)。
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
        // 用 api 客户端(始终指向 API 服务端 A)兑换,而不是当前页面的相对路径。
        // 跨域登录时本页落在域名 B 上,相对路径会指到 B 而非 A。
        // 后端响应会 Set-Cookie 写入 httpOnly token,客户端只需刷新登录态。
        await api.exchangeOAuthCode(exchangeCode);
        if (cancelled) return;
        await fetchUser();
        if (cancelled) return;
        navigate('/', { replace: true });
      } catch {
        if (!cancelled) setRuntimeError(t('authCallback.authFailed'));
      }
    })();
    return () => { cancelled = true; };
  }, [exchangeCode, oauthError, fetchUser, navigate]);

  if (error) {
    return (
      <div className="auth-callback-page">
        <div className="auth-callback-card">
          <div className="auth-callback-icon">✕</div>
          <h2>{t('authCallback.authFailed')}</h2>
          <p className="auth-callback-error">{error}</p>
          <div className="auth-callback-actions">
            <Link to="/login" className="btn btn-primary">{t('authCallback.backToLogin')}</Link>
            {window.location.origin && (
              <a className="btn btn-secondary" href={window.location.origin}>{t('authCallback.backToHome')}</a>
            )}
          </div>
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
