import { useEffect, useState } from 'react';
import { apiFetch, getCurrentUser } from '../api';
import ConfirmDialog from './ConfirmDialog';

export default function ReviewQueue({ clientId }) {
  const [transactions, setTransactions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleteError, setDeleteError] = useState(null);
  const [lockOverridePrompt, setLockOverridePrompt] = useState(null); // { message, retry: () => void }
  const isAdmin = getCurrentUser()?.role === 'admin';
  const PAGE_SIZE = 100;

  const load = () => {
    const params = new URLSearchParams({ client_id: clientId, limit: PAGE_SIZE, offset });
    if (search) params.append('q', search);
    apiFetch(`/api/transactions?${params}`).then((r) => r.json()).then((data) => {
      setTransactions(data.transactions || []);
      setTotal(data.total || 0);
    });
    apiFetch(`/api/clients/${clientId}`).then((r) => r.json()).then((c) => setAccounts(c.accounts || []));
    apiFetch(`/api/vendors?client_id=${clientId}`).then((r) => r.json()).then(setVendors);
  };

  useEffect(load, [clientId, offset, search]);

  const isLockError = (message) => message && message.toLowerCase().includes('locked period');

  const deleteTransaction = async (override) => {
    const params = override ? '?override_lock=true' : '';
    const res = await apiFetch(`/api/transactions/${confirmDeleteId}${params}`, { method: 'DELETE' });
    if (res.ok) {
      setConfirmDeleteId(null);
      setLockOverridePrompt(null);
      load();
    } else {
      const data = await res.json();
      if (isAdmin && isLockError(data.error)) {
        setConfirmDeleteId(null);
        setLockOverridePrompt({ message: data.error, retry: () => deleteTransaction(true) });
      } else {
        setDeleteError(data.error);
      }
    }
  };

  const updateTransaction = async (id, updates, override) => {
    const res = await apiFetch(`/api/transactions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(override ? { ...updates, override_lock: true } : updates),
    });
    if (res.ok) {
      load();
    } else {
      const data = await res.json();
      if (isAdmin && isLockError(data.error)) {
        setLockOverridePrompt({ message: data.error, retry: () => updateTransaction(id, updates, true) });
      } else {
        setDeleteError(data.error);
      }
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
        <input
          placeholder="Search descriptions…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
          style={{ padding: 8, fontSize: 14, flex: 1 }}
        />
      </div>
      <p style={{ color: '#666', fontSize: 13 }}>
        {transactions.filter((t) => t.needs_review).length} transaction(s) on this page need review, {total} total.
        Assign each one to an account, flag business vs. personal, and tag a vendor if it should count toward a 1099.
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
            <th style={cell}>Date</th>
            <th style={cell}>Description</th>
            <th style={cell}>Amount</th>
            <th style={cell}>Account</th>
            <th style={cell}>Business?</th>
            <th style={cell}>Vendor (1099)</th>
            <th style={cell}></th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => (
            <tr key={t.id} style={{ borderBottom: '1px solid #f0f0f0', background: t.possible_duplicate ? '#fef2f2' : t.needs_review ? '#fffbeb' : 'white' }}>
              <td style={cell}>{t.txn_date?.slice(0, 10)}</td>
              <td style={cell}>
                {t.description}
                {t.possible_duplicate && (
                  <div style={{ fontSize: 11, color: '#dc2626' }}>⚠ Possible duplicate of an existing transaction</div>
                )}
              </td>
              <td style={cell}>{Number(t.amount).toFixed(2)}</td>
              <td style={cell}>
                <select
                  value={t.account_id || ''}
                  onChange={(e) => updateTransaction(t.id, { account_id: e.target.value })}
                >
                  <option value="" disabled>Choose account…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </td>
              <td style={cell}>
                <select
                  value={t.is_business === null ? '' : String(t.is_business)}
                  onChange={(e) => updateTransaction(t.id, { is_business: e.target.value === 'true' })}
                >
                  <option value="" disabled>—</option>
                  <option value="true">Business</option>
                  <option value="false">Personal</option>
                </select>
              </td>
              <td style={cell}>
                <select
                  value={t.vendor_id || ''}
                  onChange={(e) => updateTransaction(t.id, { vendor_id: e.target.value || null })}
                >
                  <option value="">— none —</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </td>
              <td style={cell}>
                {!t.flagged_as_business && !t.journal_entry_id && (
                  <button onClick={() => setConfirmDeleteId(t.id)} style={{ fontSize: 12, cursor: 'pointer', color: '#dc2626' }}>
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
        <button disabled={offset === 0} onClick={() => setOffset(Math.max(offset - PAGE_SIZE, 0))} style={{ cursor: offset === 0 ? 'default' : 'pointer' }}>
          Previous
        </button>
        <span style={{ fontSize: 13, color: '#666' }}>
          {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
        </span>
        <button disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)} style={{ cursor: offset + PAGE_SIZE >= total ? 'default' : 'pointer' }}>
          Next
        </button>
      </div>

      {confirmDeleteId && (
        <ConfirmDialog
          title="Delete transaction"
          message="This cannot be undone. Are you sure?"
          confirmLabel="Delete"
          onConfirm={() => deleteTransaction(false)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
      {deleteError && (
        <ConfirmDialog
          title="Couldn't delete"
          message={deleteError}
          confirmLabel="OK"
          danger={false}
          onConfirm={() => setDeleteError(null)}
          onCancel={() => setDeleteError(null)}
        />
      )}
      {lockOverridePrompt && (
        <ConfirmDialog
          title="Period is locked"
          message={`${lockOverridePrompt.message} As an admin, you can override this for this one action — it will be logged.`}
          confirmLabel="Override and proceed"
          onConfirm={() => { lockOverridePrompt.retry(); }}
          onCancel={() => setLockOverridePrompt(null)}
        />
      )}
    </div>
  );
}

const cell = { padding: '8px 6px' };
