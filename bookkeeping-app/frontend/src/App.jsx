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
import { apiFetch, getCurrentUser } from './api';

export default function App() {
  const [loggedIn, setLoggedIn] = useState(!!localStorage.getItem('auth_token'));
  const [customerId, setCustomerId] = useState(null);
  const [clientId, setClientId] = useState(null);
  const [clientEntityType, setClientEntityType] = useState(null);
  const [tab, setTab] = useState('Upload');

  useEffect(() => {
    if (!clientId) return;
    apiFetch(`/api/clients/${clientId}`).then((r) => r.json()).then((c) => setClientEntityType(c.entity_type));
  }, [clientId]);

  if (!loggedIn) return <Login onLogin={() => setLoggedIn(true)} />;

  const currentUser = getCurrentUser();
  const showOwnersTab = ['partnership', 's_corp'].includes(clientEntityType);
  const baseTabs = ['Upload', 'Review', 'Reports', 'Journal Entries', 'Vendors', 'Assets', 'Loans', 'Payroll'];
  const tabs = [
    ...baseTabs.slice(0, 2),
    ...(showOwnersTab ? ['Owners'] : []),
    ...baseTabs.slice(2),
    ...(currentUser?.role === 'admin' ? ['Staff'] : []),
  ];

  const logout = () => {
    localStorage.removeItem('auth_token');
    setLoggedIn(false);
  };

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>Bookkeeping Processor</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {currentUser && <span style={{ fontSize: 13, color: '#888' }}>{currentUser.email}</span>}
          <button onClick={logout} style={{ padding: '6px 10px', cursor: 'pointer' }}>Log out</button>
        </div>
      </header>

      <div style={{ marginBottom: 16 }}>
        <CustomerPicker onSelect={setCustomerId} selectedCustomerId={customerId} />
      </div>

      {customerId && (
        <div style={{ marginBottom: 16 }}>
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
              >
                {t}
              </button>
            ))}
          </nav>

          <main style={styles.main}>
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
        <p style={styles.emptyState}>Select or create a business above for this client.</p>
      )}
      {!customerId && <p style={styles.emptyState}>Select or create a client (person) above to get started.</p>}
    </div>
  );
}

const styles = {
  page: { fontFamily: 'system-ui, sans-serif', maxWidth: 960, margin: '0 auto', padding: '24px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 22, fontWeight: 600, margin: 0 },
  tabs: { display: 'flex', gap: 8, borderBottom: '1px solid #ddd', marginBottom: 20, flexWrap: 'wrap' },
  tabButton: { padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, color: '#666' },
  tabButtonActive: { borderBottom: '2px solid #2563eb', color: '#2563eb', fontWeight: 600 },
  main: { minHeight: 300 },
  emptyState: { color: '#888', marginTop: 40, textAlign: 'center' },
};
