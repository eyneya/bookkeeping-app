import { useState } from 'react';
import { API_BASE } from '../api';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const path = isRegistering ? '/api/auth/register' : '/api/auth/login';
      const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
        return;
      }
      if (isRegistering) {
        // Registration succeeded — now log in with the same credentials
        setIsRegistering(false);
        setError('Account created. Log in below.');
      } else {
        localStorage.setItem('auth_token', data.token);
        onLogin();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 360, margin: '80px auto', fontFamily: 'system-ui, sans-serif' }}>
      <h2>{isRegistering ? 'Create account' : 'Log in'}</h2>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ padding: 10, fontSize: 14 }}
          required
        />
        <input
          type="password"
          placeholder={isRegistering ? 'Password (12+ characters)' : 'Password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ padding: 10, fontSize: 14 }}
          required
        />
        {error && <p style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>}
        <button type="submit" disabled={loading} style={{ padding: 10, cursor: 'pointer' }}>
          {loading ? 'Please wait…' : isRegistering ? 'Create account' : 'Log in'}
        </button>
      </form>
      <button
        onClick={() => { setIsRegistering(!isRegistering); setError(null); }}
        style={{ marginTop: 12, background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 13 }}
      >
        {isRegistering ? 'Already have an account? Log in' : 'First time? Create the admin account'}
      </button>
    </div>
  );
}
