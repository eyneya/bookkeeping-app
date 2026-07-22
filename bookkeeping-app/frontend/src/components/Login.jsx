import { useState } from 'react';
import { supabase } from '../api';
import { colors, fonts, spacing, radius, shadows, button, input, alert } from '../theme';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setLoading(true);
    try {
      if (isRegistering) {
        const { error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) {
          setError(signUpError.message);
          return;
        }
        setIsRegistering(false);
        setSuccessMsg('Account created successfully. Log in below with your credentials.');
        setPassword('');
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
          setError(signInError.message);
          return;
        }
        onLogin();
      }
    } catch (err) {
      setError(err.message || 'Unable to reach the server. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.card} className="fade-in-up">
        {/* Brand header */}
        <div style={styles.brandHeader}>
          <div style={styles.logoMark}>
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <rect width="40" height="40" rx="10" fill={colors.teal} />
              <path d="M12 26 L20 14 L28 26" stroke={colors.white} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              <path d="M15 26 L20 19 L25 26" stroke={colors.white} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.6" />
              <circle cx="20" cy="26" r="2" fill={colors.white} />
            </svg>
          </div>
          <h1 style={styles.brandTitle}>Eyneya</h1>
          <p style={styles.brandSubtitle}>Business Solutions</p>
        </div>

        {/* Form */}
        <div style={styles.formSection}>
          <h2 style={styles.formTitle}>{isRegistering ? 'Create admin account' : 'Welcome back'}</h2>
          <p style={styles.formDesc}>
            {isRegistering
              ? 'Set up the first administrator account to get started.'
              : 'Sign in to your bookkeeping workspace.'}
          </p>

          <form onSubmit={submit} style={styles.form}>
            <div style={styles.field}>
              <label style={styles.label}>Email</label>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={input.base}
                required
                autoComplete="email"
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Password</label>
              <input
                type="password"
                placeholder={isRegistering ? 'At least 12 characters' : 'Enter your password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={input.base}
                required
                autoComplete={isRegistering ? 'new-password' : 'current-password'}
              />
              {isRegistering && (
                <p style={styles.hint}>Must be at least 12 characters for security.</p>
              )}
            </div>

            {error && (
              <div style={{ ...alert.error, display: 'flex', alignItems: 'flex-start', gap: spacing.sm }} className="slide-down">
                <span style={{ flexShrink: 0, fontWeight: fonts.weightBold }}>!</span>
                <span>{error}</span>
              </div>
            )}
            {successMsg && (
              <div style={{ ...alert.success, display: 'flex', alignItems: 'flex-start', gap: spacing.sm }} className="slide-down">
                <span style={{ flexShrink: 0, fontWeight: fonts.weightBold }}>&#10003;</span>
                <span>{successMsg}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{ ...button.primary, width: '100%', padding: '12px 20px', fontSize: fonts.sizeMd }}
            >
              {loading ? 'Please wait…' : isRegistering ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <div style={styles.toggleRow}>
            {isRegistering ? (
              <span style={styles.toggleText}>
                Already have an account?{' '}
                <button
                  onClick={() => { setIsRegistering(false); setError(null); setSuccessMsg(null); }}
                  style={button.link}
                >
                  Sign in
                </button>
              </span>
            ) : (
              <span style={styles.toggleText}>
                First time?{' '}
                <button
                  onClick={() => { setIsRegistering(true); setError(null); setSuccessMsg(null); }}
                  style={button.link}
                >
                  Create the admin account
                </button>
              </span>
            )}
          </div>
        </div>
      </div>

      <p style={styles.footer}>Eyneya Business Solutions — Secure Bookkeeping Platform</p>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: `linear-gradient(135deg, ${colors.navy} 0%, ${colors.navyLight} 100%)`,
    padding: spacing.xl,
    position: 'relative',
  },
  card: {
    width: 420,
    maxWidth: '100%',
    background: colors.white,
    borderRadius: radius.xl,
    boxShadow: shadows.xl,
    overflow: 'hidden',
  },
  brandHeader: {
    background: colors.navy,
    padding: `${spacing.xxl}px ${spacing.xl}px`,
    textAlign: 'center',
  },
  logoMark: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  brandTitle: {
    fontSize: fonts.size2xl,
    fontWeight: fonts.weightBold,
    color: colors.white,
    margin: 0,
    lineHeight: fonts.lineHeightHeading,
    letterSpacing: '-0.02em',
  },
  brandSubtitle: {
    fontSize: fonts.sizeSm,
    color: colors.tealLight,
    marginTop: spacing.xs,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    fontWeight: fonts.weightMedium,
  },
  formSection: {
    padding: spacing.xxl,
  },
  formTitle: {
    fontSize: fonts.sizeLg,
    fontWeight: fonts.weightSemibold,
    color: colors.navy,
    margin: 0,
    marginBottom: spacing.xs,
  },
  formDesc: {
    fontSize: fonts.sizeSm,
    color: colors.textMuted,
    marginBottom: spacing.xl,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.lg,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.xs,
  },
  label: {
    fontSize: fonts.sizeSm,
    fontWeight: fonts.weightMedium,
    color: colors.gray700,
  },
  hint: {
    fontSize: fonts.sizeXs,
    color: colors.textSubtle,
  },
  toggleRow: {
    marginTop: spacing.xl,
    textAlign: 'center',
    paddingTop: spacing.xl,
    borderTop: `1px solid ${colors.borderLight}`,
  },
  toggleText: {
    fontSize: fonts.sizeSm,
    color: colors.textMuted,
  },
  footer: {
    marginTop: spacing.xl,
    fontSize: fonts.sizeXs,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: '0.04em',
  },
};
