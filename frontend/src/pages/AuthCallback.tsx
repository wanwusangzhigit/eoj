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
};

export default function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setToken, fetchUser } = useAuthStore();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get('token');
    const oauthError = searchParams.get('error');
    const errorDesc = searchParams.get('error_description');

    if (oauthError) {
      setError(errorKeyMap[oauthError] ? t(errorKeyMap[oauthError]) : (errorDesc || oauthError));
      return;
    }

    if (token) {
      setToken(token);
      fetchUser()
        .then(() => {
          navigate('/', { replace: true });
        })
        .catch(() => {
          setError(t('authCallback.authFailed'));
        });
    } else {
      setError(t('authCallback.authFailed'));
    }
  }, [searchParams]);

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
