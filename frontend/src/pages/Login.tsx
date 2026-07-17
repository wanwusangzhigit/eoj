import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { useSettingsStore } from '../store/settings';
import { api } from '../api/client';
import { Code2 } from 'lucide-react';
import { useSiteConfig } from '../hooks/useSiteConfig';
import { t } from '../i18n';
import './Login.css';

const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1';

export default function Login() {
  const { user, setToken, fetchUser } = useAuthStore();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const config = useSiteConfig();

  // Site settings from cached settings store
  const getRegistrationOpen = useSettingsStore((s) => s.getRegistrationOpen);
  const getEmailRequired = useSettingsStore((s) => s.getEmailRequired);
  const getEmailSuffixes = useSettingsStore((s) => s.getEmailSuffixes);
  const [registrationOpen, setRegistrationOpen] = useState(true);
  const [emailRequired, setEmailRequired] = useState(false);
  const [emailSuffixes, setEmailSuffixes] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [captchaUuid, setCaptchaUuid] = useState('');
  const [captchaSvg, setCaptchaSvg] = useState('');
  const [captchaType, setCaptchaType] = useState<'text' | 'math'>('text');
  const [captchaAnswerLen, setCaptchaAnswerLen] = useState(4);
  const [captchaAnswer, setCaptchaAnswer] = useState('');

  useEffect(() => {
    setRegistrationOpen(getRegistrationOpen());
    setEmailRequired(getEmailRequired());
    setEmailSuffixes(getEmailSuffixes());
  }, []);

  // Fetch captcha on mount and when switching mode
  useEffect(() => {
    fetchCaptcha();
  }, [mode]);

  const fetchCaptcha = async () => {
    try {
      const data = await api.getCaptcha();
      setCaptchaUuid(data.uuid);
      setCaptchaSvg(data.svg);
      setCaptchaType(data.type);
      setCaptchaAnswerLen(data.answer_length);
      setCaptchaAnswer('');
    } catch {
      // captcha unavailable, proceed without
    }
  };

  if (user) {
    navigate('/', { replace: true });
    return null;
  }

  const switchMode = (nextMode: 'login' | 'register') => {
    setMode(nextMode);
    setError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!username.trim() || !password) {
      setError(t('login.usernameRequired'));
      return;
    }

    if (mode === 'register') {
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(username.trim())) {
        setError(t('common.usernameInvalid'));
        return;
      }
      if (password.length < 8) {
        setError(t('login.passwordTooShort'));
        return;
      }
      if (password !== confirmPassword) {
        setError(t('login.passwordMismatch'));
        return;
      }
      if (emailRequired && !email.trim()) {
        setError(t('login.emailRequiredError'));
        return;
      }
      if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        setError(t('common.emailInvalid'));
        return;
      }
      if (email.trim() && emailSuffixes) {
        const allowed = emailSuffixes.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        const emailLower = email.trim().toLowerCase();
        if (!allowed.some(s => emailLower.endsWith(s))) {
          setError(t('login.emailSuffixError'));
          return;
        }
      }
      if (!agreed) {
        setError(t('login.mustAgree'));
        return;
      }
    }

    try {
      setLoading(true);
      const data = mode === 'register'
        ? await api.register(username.trim(), password, email.trim() || undefined, captchaUuid, captchaAnswer)
        : await api.login(username.trim(), password, captchaUuid, captchaAnswer);

      setToken(data.token);
      await fetchUser();
      navigate('/', { replace: true });
    } catch (err: any) {
      setError(err.message || t('login.authFailed'));
      if (err.message?.includes('CAPTCHA')) {
        fetchCaptcha();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-hero">
        <div className="hero-icon">
          {config.site.icon === 'default' ? <Code2 size={48} /> : <img src={config.site.icon} alt={config.site.name} style={{width: 48, height: 48}} />}
        </div>
        <h1>{config.login.hero_title || t('login.title')}</h1>
        <p className="hero-subtitle">{config.login.hero_subtitle || t('login.subtitle')}</p>

        <div className="auth-card">
          {registrationOpen ? (
            <div className="auth-toggle">
              <button
                type="button"
                className={mode === 'login' ? 'toggle-btn active' : 'toggle-btn'}
                onClick={() => switchMode('login')}
              >
                {t('login.login')}
              </button>
              <button
                type="button"
                className={mode === 'register' ? 'toggle-btn active' : 'toggle-btn'}
                onClick={() => switchMode('register')}
              >
                {t('login.register')}
              </button>
            </div>
          ) : (
            <div className="auth-toggle">
              <button
                type="button"
                className="toggle-btn active"
                disabled
              >
                {t('login.login')}
              </button>
            </div>
          )}

          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="username">{t('login.username')}</label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t('login.usernamePlaceholder')}
                required
              />
            </div>

            {mode === 'register' && (
              <div className="form-group">
                <label htmlFor="email">{emailRequired ? t('login.emailRequired') : t('login.email')}</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('login.emailPlaceholder')}
                  required={emailRequired}
                />
                {emailSuffixes && (
                  <p style={{fontSize:'12px',color:'var(--text-secondary)',marginTop:'4px'}}>
                    {t('login.emailSuffixHint').replace('{0}', emailSuffixes)}
                  </p>
                )}
              </div>
            )}

            <div className="form-group">
              <label htmlFor="password">{t('login.password')}</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('login.passwordPlaceholder')}
                required
              />
            </div>

            {mode === 'register' && (
              <div className="form-group">
                <label htmlFor="confirmPassword">{t('login.confirmPassword')}</label>
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t('login.confirmPasswordPlaceholder')}
                  required
                />
              </div>
            )}

            {mode === 'register' && (
              <div className="form-agree">
                <label className="agree-label">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                  />
                  <span>
                    {t('login.agreePrefix')}
                    <Link to="/privacy" target="_blank" rel="noopener noreferrer">{t('privacy.title')}</Link>
                    {t('login.agreeAnd')}
                    <Link to="/terms" target="_blank" rel="noopener noreferrer">{t('terms.title')}</Link>
                  </span>
                </label>
              </div>
            )}

            {/* CAPTCHA */}
            {captchaSvg && (
              <div className="form-group captcha-group">
                <label>{t('login.captcha')}</label>
                <div className="captcha-container" style={{display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap'}}>
                  <div
                    className="captcha-image"
                    dangerouslySetInnerHTML={{ __html: captchaSvg }}
                    style={{border:'1px solid var(--border)', borderRadius:'6px', cursor:'pointer', lineHeight:0}}
                    onClick={fetchCaptcha}
                    title={t('login.captchaRefresh')}
                  />
                  <input
                    type="text"
                    value={captchaAnswer}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (captchaType === 'math' ? /^\d*$/.test(val) : true) {
                        setCaptchaAnswer(val);
                      }
                    }}
                    placeholder={captchaType === 'math' ? t('login.captchaMathPlaceholder') : t('login.captchaPlaceholder')}
                    required
                    maxLength={captchaAnswerLen}
                    style={{width: captchaType === 'math' ? '120px' : '80px', textAlign:'center', letterSpacing: captchaType === 'math' ? '2px' : '4px', fontWeight:'bold'}}
                    inputMode={captchaType === 'math' ? 'numeric' : 'text'}
                  />
                  <button type="button" className="btn btn-sm" onClick={fetchCaptcha} style={{fontSize:'12px'}}>
                    {t('login.captchaRefresh')}
                  </button>
                </div>
              </div>
            )}

            {error && <div className="form-error">{error}</div>}

            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? (mode === 'register' ? t('login.registering') : t('login.loggingIn')) : (mode === 'register' ? t('login.registerButton') : t('login.loginButton'))}
            </button>
          </form>

          {!registrationOpen && (
            <p style={{fontSize:'13px',color:'var(--text-secondary)',textAlign:'center',marginTop:'8px'}}>
              {t('login.registrationClosed')}
            </p>
          )}

          <div className="form-divider">{t('login.or')}</div>

          {config.login.show_github && <a href={`${API_BASE}/auth/github`} className="btn btn-github">
            <svg height="20" viewBox="0 0 16 16" width="20" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            {t('login.continueWithGithub')}
          </a>}

          {config.login.show_cpoauth && <a href={`${API_BASE}/auth/cpoauth`} className="btn btn-cpoauth">
            <svg height="20" viewBox="0 0 24 24" width="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            {t('login.continueWithCpOAuth')}
          </a>}
        </div>
      </div>
    </div>
  );
}
