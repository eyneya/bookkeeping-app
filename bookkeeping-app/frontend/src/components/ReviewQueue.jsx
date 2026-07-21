import { useEffect, useState } from 'react';
import { apiFetch, getCurrentUser } from '../api';
import ConfirmDialog from './ConfirmDialog';
import { colors, fonts, spacing, radius, button, input, select, table, alert, badge } from '../theme';

export default function ReviewQueue({ clientId }) {
  const [transactions, setTransactions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleteError, setDeleteError] = useState(null);
  const [lockOverridePrompt, setLockOverridePrompt] = useState(null);
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

  const needsReviewCount = transactions.filter((t) => t.needs_review).length;

  return (
    <div>
      <h3 style={styles.title}>Review Queue</h3>
      <div style={{ display: 'flex', gap: spacing.sm, marginBottom: spacing.lg, alignItems: 'center' }}>
        <input
          placeholder="Search descriptions…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
          style={{ ...input.base, flex: 1, maxWidth: 360 }}
        />
      </div>

      <div style={{ ...alert.info, marginBottom: spacing.lg, display: 'flex', alignItems: 'center', gap: spacing.sm }}>
        <span style={{ ...badge.base, ...badge.warning, flexShrink: 0 }}>{needsReviewCount}</span>
        <span>{needsReviewCount} transaction(s) on this page need review, {total} total. Assign each one to an account, flag business vs. personal, and tag a vendor if it should count toward a 1099.</span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={table.container}>
          <thead>
            <tr>
              <th style={table.headerCell}>Date</th>
              <th style={table.headerCell}>Description</th>
              <th style={table.headerCell}>Amount</th>
              <th style={table.headerCell}>Account</th>
              <th style={table.headerCell}>Business?</th>
              <th style={table.headerCell}>Vendor (1099)</th>
              <th style={table.headerCell}></th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => (
              <tr
                key={t.id}
                className="hoverable-row"
                style={{
                  ...table.row,
                  background: t.possible_duplicate ? colors.errorBg : t.needs_review ? colors.warningBg : colors.white,
                }}
              >
                <td style={table.cell}>{t.txn_date?.slice(0, 10)}</td>
                <td style={table.cell}>
                  {t.description}
                  {t.possible_duplicate && (
                    <div style={{ fontSize: fonts.sizeXs, color: colors.error, marginTop: spacing.xs }}>
                      &#9888; Possible duplicate of an existing transaction
                    </div>
                  )}
                </td>
                <td style={{ ...table.cell, fontFamily: fonts.mono, fontWeight: fonts.weightMedium }}>{Number(t.amount).toFixed(2)}</td>
                <td style={table.cell}>
                  <select
                    value={t.account_id || ''}
                    onChange={(e) => updateTransaction(t.id, { account_id: e.target.value })}
                    style={{ ...input.small, minWidth: 140 }}
                  >
                    <option value="" disabled>Choose account…</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </td>
                <td style={table.cell}>
                  <select
                    value={t.is_business === null ? '' : String(t.is_business)}
                    onChange={(e) => updateTransaction(t.id, { is_business: e.target.value === 'true' })}
                    style={{ ...input.small, minWidth: 100 }}
                  >
                    <option value="" disabled>—</option>
                    <option value="true">Business</option>
                    <option value="false">Personal</option>
                  </select>
                </td>
                <td style={table.cell}>
                  <select
                    value={t.vendor_id || ''}
                    onChange={(e) => updateTransaction(t.id, { vendor_id: e.target.value || null })}
                    style={{ ...input.small, minWidth: 120 }}
                  >
                    <option value="">— none —</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                </td>
                <td style={table.cell}>
                  {!t.flagged_as_business && !t.journal_entry_id && (
                    <button onClick={() => setConfirmDeleteId(t.id)} style={button.smallDanger}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {transactions.length === 0 && (
              <tr>
                <td colSpan={7} style={{ ...table.cell, textAlign: 'center', color: colors.textSubtle, padding: spacing.xxxl }}>
                  No transactions to review.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center', marginTop: spacing.lg }}>
        <button disabled={offset === 0} onClick={() => setOffset(Math.max(offset - PAGE_SIZE, 0))} style={button.secondary}>
          Previous
        </button>
        <span style={{ fontSize: fonts.sizeSm, color: colors.textMuted }}>
          {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
        </span>
        <button disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)} style={button.secondary}>
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

const styles = {
  title: { fontSize: fonts.sizeLg, fontWeight: fonts.weightSemibold, color: colors.navy, margin: `0 0 ${spacing.lg}px` },
};
