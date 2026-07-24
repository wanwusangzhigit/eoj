import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import { api } from '../api/client';
import { t } from '../i18n';

interface CaptchaData {
  uuid: string;
  answer: string;
}

interface CaptchaProps {
  onCaptchaReady: (data: CaptchaData) => void;
  onCaptchaChange: (answer: string) => void;
  captchaAnswer: string;
}

export interface CaptchaHandle {
  refresh: () => void;
}

const Captcha = forwardRef<CaptchaHandle, CaptchaProps>(({ onCaptchaReady, onCaptchaChange, captchaAnswer }, ref) => {
  const [png, setPng] = useState('');
  const [type, setType] = useState<'text' | 'math'>('text');
  const [answerLen, setAnswerLen] = useState(4);
  const readyRef = useRef(onCaptchaReady);
  const changeRef = useRef(onCaptchaChange);
  readyRef.current = onCaptchaReady;
  changeRef.current = onCaptchaChange;

  const fetchCaptcha = useCallback(async () => {
    try {
      const data = await api.getCaptcha();
      setPng(data.png);
      setType(data.type);
      setAnswerLen(data.answer_length);
      readyRef.current({ uuid: data.uuid, answer: '' });
      changeRef.current('');
    } catch {
      // captcha unavailable
    }
  }, []); // Stable: no external deps, uses refs for callbacks

  useImperativeHandle(ref, () => ({ refresh: fetchCaptcha }), [fetchCaptcha]);

  useEffect(() => {
    fetchCaptcha();
  }, [fetchCaptcha]);

  return (
    <div className="form-group captcha-group">
      <label>{t('login.captcha')}</label>
      <div className="captcha-container" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        {png && (
          <img
            className="captcha-image"
            src={`data:image/png;base64,${png}`}
            alt="captcha"
            style={{ border: '1px solid var(--border)', borderRadius: '6px', cursor: 'pointer', width: '200px', height: '70px' }}
            onClick={fetchCaptcha}
            title={t('login.captchaRefresh')}
          />
        )}
        <input
          type="text"
          value={captchaAnswer}
          onChange={(e) => {
            const val = e.target.value;
            if (type === 'math' ? /^\d*$/.test(val) : true) {
              onCaptchaChange(val);
            }
          }}
          placeholder={type === 'math' ? t('login.captchaMathPlaceholder') : t('login.captchaPlaceholder')}
          required
          maxLength={answerLen}
          style={{
            width: type === 'math' ? '120px' : '80px',
            textAlign: 'center',
            letterSpacing: type === 'math' ? '2px' : '4px',
            fontWeight: 'bold',
          }}
          inputMode={type === 'math' ? 'numeric' : 'text'}
        />
        <button type="button" className="btn btn-sm" onClick={fetchCaptcha} style={{ fontSize: '12px' }}>
          {t('login.captchaRefresh')}
        </button>
      </div>
    </div>
  );
});

export default Captcha;