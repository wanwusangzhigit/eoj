import { useState } from 'react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { t } from '../i18n';
import { Mail, Copy, Check } from 'lucide-react';
import './Legal.css';

const CONTACT_EMAIL = 'jasonliuwanwu@gmail.com';

export default function Contact() {
  useDocumentTitle(t('contact.title'));
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  return (
    <div className="legal-page">
      <div className="legal-container contact-container">
        <h1>{t('contact.title')}</h1>
        <p className="contact-intro">{t('contact.intro')}</p>

        <div className="contact-card">
          <div className="contact-method">
            <div className="contact-method-icon">
              <Mail size={24} />
            </div>
            <div className="contact-method-info">
              <div className="contact-method-label">{t('contact.emailLabel')}</div>
              <div className="contact-method-value">{CONTACT_EMAIL}</div>
            </div>
            <button
              className="contact-copy-btn"
              onClick={handleCopy}
              title={t('contact.copy')}
              aria-label={t('contact.copy')}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </div>
          <a className="btn btn-primary contact-mailto-btn" href={`mailto:${CONTACT_EMAIL}`}>
            <Mail size={16} />
            {t('contact.sendEmail')}
          </a>
        </div>

        <section className="contact-section">
          <h2>{t('contact.responseTitle')}</h2>
          <p>{t('contact.responseBody')}</p>
        </section>

        <section className="contact-section">
          <h2>{t('contact.topicsTitle')}</h2>
          <ul>
            <li>{t('contact.topic1')}</li>
            <li>{t('contact.topic2')}</li>
            <li>{t('contact.topic3')}</li>
            <li>{t('contact.topic4')}</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
