import { t } from '../i18n';
import './LoadingSpinner.css';

interface LoadingSpinnerProps {
  message?: string;
}

export default function LoadingSpinner({ message = t('common.loading') }: LoadingSpinnerProps) {
  return (
    <div className="loading-container">
      <div className="loading-spinner"></div>
      <p>{message}</p>
    </div>
  );
}
