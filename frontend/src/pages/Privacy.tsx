import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { t } from '../i18n';
import './Legal.css';

export default function Privacy() {
  useDocumentTitle(t('privacy.title'));
  return (
    <div className="legal-page">
      <div className="legal-container">
        <h1>{t('privacy.title')}</h1>
        <p className="legal-updated">{t('privacy.updated').replace('{0}', '2026-07-05')}</p>

        <section>
          <h2>{t('privacy.section1Title')}</h2>
          <p>{t('privacy.section1Body')}</p>
        </section>

        <section>
          <h2>{t('privacy.section2Title')}</h2>
          <p>{t('privacy.section2Body')}</p>
          <ul>
            <li>{t('privacy.section2Item1')}</li>
            <li>{t('privacy.section2Item2')}</li>
            <li>{t('privacy.section2Item3')}</li>
            <li>{t('privacy.section2Item4')}</li>
          </ul>
        </section>

        <section>
          <h2>{t('privacy.section3Title')}</h2>
          <p>{t('privacy.section3Body')}</p>
        </section>

        <section>
          <h2>{t('privacy.section4Title')}</h2>
          <p>{t('privacy.section4Body')}</p>
        </section>

        <section>
          <h2>{t('privacy.section5Title')}</h2>
          <p>{t('privacy.section5Body')}</p>
        </section>

        <section>
          <h2>{t('privacy.section6Title')}</h2>
          <p>{t('privacy.section6Body').replace('{email}', 'jasonliuwanwu@gmail.com')}</p>
        </section>
      </div>
    </div>
  );
}
