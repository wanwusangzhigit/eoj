import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { t } from '../i18n';
import './ErrorBoundary.css';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleRefresh = (): void => {
    window.location.reload();
  };

  handleGoHome = (): void => {
    window.location.href = '/';
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <AlertTriangle size={48} className="error-boundary-icon" />
          <h2 className="error-boundary-title">{t('common.errorBoundary')}</h2>
          <div className="error-boundary-actions">
            <button className="btn btn-primary" onClick={this.handleRefresh}>
              <RefreshCw size={16} />
              {t('common.refreshPage')}
            </button>
            <button className="btn btn-secondary" onClick={this.handleGoHome}>
              <Home size={16} />
              {t('common.backToHome')}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
