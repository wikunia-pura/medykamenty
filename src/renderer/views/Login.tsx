import React, { useState } from 'react';

interface LoginProps {
  onSignedIn: () => void;
}

const Login: React.FC<LoginProps> = ({ onSignedIn }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await window.electronAPI.authSignIn(email, password);
      if (result.ok) {
        onSignedIn();
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nieznany błąd logowania.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card card">
        <div className="login-brand">
          <div className="login-title">Cutis Production Planner</div>
          <div className="login-subtitle">Zaloguj się, aby kontynuować</div>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <label className="login-field">
            <span>E-mail</span>
            <input
              className="input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="username"
              disabled={submitting}
            />
          </label>

          <label className="login-field">
            <span>Hasło</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              disabled={submitting}
            />
          </label>

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="btn primary-filled login-submit" disabled={submitting}>
            {submitting ? 'Logowanie…' : 'Zaloguj'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;
