import React from 'react';
import { translations } from '../translations';
import type { Lang } from '../../shared/types';

interface Props {
  // The boundary may sit outside the I18nProvider (main.tsx), so it reads the
  // strings itself; defaults to Polish, the app's default language.
  lang?: Lang;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

// Catches an exception thrown while rendering so the window shows a message
// and a way out instead of going blank.
class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Render error', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const t = translations[this.props.lang ?? 'pl'];
    return (
      <div className="main">
        <div className="card">
          <div className="card-title">{t.errorBoundaryTitle}</div>
          <p className="hint">{t.errorBoundaryHint}</p>
          <div className="error-text" style={{ whiteSpace: 'pre-wrap', marginBottom: 12 }}>
            {error.message}
          </div>
          <button
            type="button"
            className="btn primary-filled"
            onClick={() => window.location.reload()}
          >
            {t.errorBoundaryReload}
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
