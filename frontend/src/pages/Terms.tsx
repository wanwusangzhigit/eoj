import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { t } from '../i18n';
import './Legal.css';

export default function Terms() {
  useDocumentTitle(t('terms.title'));
  return (
    <div className="legal-page">
      <div className="legal-container">
        <h1>{t('terms.title')}</h1>
        <p className="legal-updated">{t('terms.updated').replace('{0}', '2026-07-05')}</p>

        <section>
          <h2>{t('terms.section1Title')}</h2>
          <p>{t('terms.section1Body')}</p>
        </section>

        <section>
          <h2>{t('terms.section2Title')}</h2>
          <p>{t('terms.section2Body')}</p>
        </section>

        <section>
          <h2>{t('terms.section3Title')}</h2>
          <p>{t('terms.section3Body')}</p>
        </section>

        <section>
          <h2>{t('terms.section4Title')}</h2>
          <p>{t('terms.section4Body')}</p>
        </section>

        <section>
          <h2>{t('terms.section5Title')}</h2>
          <p>{t('terms.section5Body')}</p>
        </section>

        <section>
          <h2>{t('terms.section6Title')}</h2>
          <p>{t('terms.section6Body')}</p>
        </section>

        <section>
          <h2>{t('terms.section7Title')}</h2>
          <p>{t('terms.section7Body').replace('{email}', 'jasonliuwanwu@gmail.com')}</p>
        </section>
      </div>
    </div>
  );
}
