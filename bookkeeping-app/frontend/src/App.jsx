import { useEffect, useState } from 'react';
import Login from './components/Login';
import CustomerPicker from './components/CustomerPicker';
import ClientPicker from './components/ClientPicker';
import UploadPanel from './components/UploadPanel';
import ReviewQueue from './components/ReviewQueue';
import Reports from './components/Reports';
import Owners from './components/Owners';
import Vendors from './components/Vendors';
import FixedAssets from './components/FixedAssets';
import Loans from './components/Loans';
import Payroll from './components/Payroll';
import JournalEntries from './components/JournalEntries';
import Staff from './components/Staff';
import { getCurrentUser, onAuthChange, signOut, getClient } from './api';
import { colors, fonts, spacing, radius, shadows, button } from './theme';

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [customerId, setCustomerId] = useState(null);
  const [clientId, setClientId] = useState(null);
  const [clientEntityType, setClientEntityType] = useState(null);
  const [tab, setTab] = useState('Upload');

  useEffect(() => {
    let subscription;
    (async () => {
      subscription = await onAuthChange(async (event, sess) => {
        setSession(sess);
        if (sess?.user) {
          const user = await getCurrentUser();
          setCurrentUser(user);
        } else {
          setCurrentUser(null);
          setCustomerId(null);
          setClientId(null);
        }
        setLoading(false);
      });
    })();
    return () => {
      if (subscription?.data?.subscription?.unsubscribe) {
        subscription.data.subscription.unsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    if (!clientId) return;
    getClient(clientId).then((c) => setClientEntityType(c.entity_type));
  }, [clientId]);

  const logout = async () => {
    await signOut();
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: colors.pageBg }}>
        <p style={{ color: colors.textMuted, fontSize: fonts.sizeMd }}>Loading…</p>
      </div>
    );
  }

  if (!session) return <Login onLogin={() => {}} />;

  const showOwnersTab = ['partnership', 's_corp'].includes(clientEntityType);
  const baseTabs = ['Upload', 'Review', 'Reports', 'Journal Entries', 'Vendors', 'Assets', 'Loans', 'Payroll'];
  const tabs = [
    ...baseTabs.slice(0, 2),
    ...(showOwnersTab ? ['Owners'] : []),
    ...baseTabs.slice(2),
    ...(currentUser?.role === 'admin' ? ['Staff'] : []),
  ];

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.logoMark}>
            <svg width="32" height="32" viewBox="0 0 40 40" fill="none">
              <rect width="40" height="40" rx="10" fill={colors.teal} />
              <path d="M12 26 L20 14 L28 26" stroke={colors.white} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              <path d="M15 26 L20 19 L25 26" stroke={colors.white} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.6" />
              <circle cx="20" cy="26" r="2" fill={colors.white} />
            </svg>
          </div>
          <div>
            <h1 style={styles.brandTitle}>Eyneya</h1>
            <span style={styles.brandSubtitle}>Business Solutions</span>
          </div>
        </div>
        <div style={styles.headerRight}>
          {currentUser && (
            <div style={styles.userBox}>
              <div style={styles.userAvatar}>{currentUser.email?.[0]?.toUpperCase()}</div>
              <span style={styles.userEmail}>{currentUser.email}</span>
            </div>
          )}
          <button onClick={logout} style={{ ...button.secondary, padding: '8px 16px', fontSize: fonts.sizeSm }}>
            Log out
          </button>
        </div>
      </header>

      <div style={styles.content}>
        <div style={styles.pickerSection} className="slide-down">
          <CustomerPicker onSelect={setCustomerId} selectedCustomerId={customerId} />
        </div>

        {customerId && (
          <div style={{ marginBottom: spacing.lg }} className="slide-down">
            <ClientPicker customerId={customerId} onSelect={setClientId} selectedClientId={clientId} />
          </div>
        )}

        {clientId && (
          <>
            <nav style={styles.tabs}>
              {tabs.map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  style={{ ...styles.tabButton, ...(tab === t ? styles.tabButtonActive : {}) }}
                  className="hoverable-row"
                >
                  {t}
                </button>
              ))}
            </nav>

            <main style={styles.main} className="fade-in">
              {tab === 'Upload' && <UploadPanel clientId={clientId} />}
              {tab === 'Review' && <ReviewQueue clientId={clientId} />}
              {tab === 'Owners' && showOwnersTab && <Owners clientId={clientId} customerId={customerId} />}
              {tab === 'Reports' && <Reports clientId={clientId} />}
              {tab === 'Journal Entries' && <JournalEntries clientId={clientId} />}
              {tab === 'Vendors' && <Vendors clientId={clientId} />}
              {tab === 'Assets' && <FixedAssets clientId={clientId} />}
              {tab === 'Loans' && <Loans clientId={clientId} />}
              {tab === 'Payroll' && <Payroll clientId={clientId} />}
              {tab === 'Staff' && currentUser?.role === 'admin' && <Staff clientId={clientId} />}
            </main>
          </>
        )}

        {customerId && !clientId && (
          <div style={styles.emptyState}>
            <p style={styles.emptyStateText}>Select or create a business above to get started.</p>
          </div>
        )}
        {!customerId && (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={colors.gray400} strokeWidth="1.5">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <p style={styles.emptyStateText}>Select or create a client to get started.</p>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  page: {
    fontFamily: fonts.family,
    minHeight: '100vh',
    background: colors.pageBg,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: colors.white,
    borderBottom: `1px solid ${colors.border}`,
    padding: `${spacing.md}px ${spacing.xxl}px`,
    boxShadow: shadows.sm,
    position: 'sticky',
    top: 0,
    zIndex: 100,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
  },
  logoMark: {
    display: 'flex',
    alignItems: 'center',
  },
  brandTitle: {
    fontSize: fonts.sizeLg,
    fontWeight: fonts.weightBold,
    color: colors.navy,
    margin: 0,
    lineHeight: 1.1,
    letterSpacing: '-0.02em',
  },
  brandSubtitle: {
    fontSize: 10,
    color: colors.teal,
    fontWeight: fonts.weightMedium,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
  },
  userBox: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
  },
  userAvatar: {
    width: 30,
    height: 30,
    borderRadius: '50%',
    background: colors.navy,
    color: colors.white,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: fonts.sizeSm,
    fontWeight: fonts.weightSemibold,
  },
  userEmail: {
    fontSize: fonts.sizeSm,
    color: colors.textMuted,
  },
  content: {
    maxWidth: 1100,
    margin: '0 auto',
    padding: `${spacing.xl}px ${spacing.xxl}px`,
  },
  pickerSection: {
    marginBottom: spacing.lg,
  },
  tabs: {
    display: 'flex',
    gap: spacing.xs,
    borderBottom: `2px solid ${colors.border}`,
    marginBottom: spacing.xl,
    flexWrap: 'wrap',
  },
  tabButton: {
    padding: `${spacing.md}px ${spacing.lg}px`,
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    fontSize: fonts.sizeBase,
    fontWeight: fonts.weightMedium,
    color: colors.textMuted,
    fontFamily: fonts.family,
    borderBottom: `2px solid transparent`,
    marginBottom: '-2px',
    transition: 'all 0.2s ease',
    borderRadius: `${radius.sm} ${radius.sm} 0 0`,
  },
  tabButtonActive: {
    color: colors.teal,
    borderBottom: `2px solid ${colors.teal}`,
    fontWeight: fonts.weightSemibold,
  },
  main: {
    minHeight: 300,
    background: colors.white,
    borderRadius: radius.lg,
    padding: spacing.xl,
    boxShadow: shadows.sm,
    border: `1px solid ${colors.border}`,
  },
  emptyState: {
    textAlign: 'center',
    padding: `${spacing.xxxl * 2}px ${spacing.xl}`,
  },
  emptyIcon: {
    marginBottom: spacing.lg,
    display: 'flex',
    justifyContent: 'center',
  },
  emptyStateText: {
    color: colors.textMuted,
    fontSize: fonts.sizeMd,
  },
};
