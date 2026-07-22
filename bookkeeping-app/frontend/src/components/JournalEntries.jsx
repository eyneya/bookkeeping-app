import { useEffect, useState } from 'react';
import { listJournalEntries, createJournalEntry, deleteJournalEntry, getClient, isLockError, getCurrentUser } from '../api';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';
import { colors, fonts, spacing, button, input, select, table, alert } from '../theme';

const ENTRY_TYPES = ['opening_balance', 'depreciation', 'accrual', 'correction', 'adjustment', 'other'];

export default function JournalEntries({ clientId }) {
  const [entries, setEntries] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [showOpeningBalanceModal, setShowOpeningBalanceModal] = useState(false);
  const [deleteEntryId, setDeleteEntryId] = useState(null);
  const [lockOverridePrompt, setLockOverridePrompt] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => { getCurrentUser().then(setCurrentUser); }, []);

  const load = async () => {
    setEntries(await listJournalEntries(clientId));
    const client = await getClient(clientId);
    setAccounts(client.accounts || []);
  };
  useEffect(load, [clientId]);

  const isAdmin = currentUser?.role === 'admin';

  const submitEntry = async (payload, override) => {
    try {
      await createJournalEntry({ client_id: clientId, ...payload, ...(override ? { override_lock: true } : {}) });
      setShowEntryModal(false);
      setShowOpeningBalanceModal(false);
      setLockOverridePrompt(null);
      load();
    } catch (err) {
      if (isAdmin && isLockError(err)) {
        setLockOverridePrompt({ message: err.message, retry: () => submitEntry(payload, true) });
      } else {
        setErrorMessage(err.message);
      }
    }
  };

  const handleDelete = async (override) => {
    try {
      await deleteJournalEntry(deleteEntryId, override);
      setDeleteEntryId(null);
      setLockOverridePrompt(null);
      load();
    } catch (err) {
      if (isAdmin && isLockError(err)) {
        setLockOverridePrompt({ message: err.message, retry: () => handleDelete(true) });
      } else {
        setErrorMessage(err.message);
        setDeleteEntryId(null);
      }
    }
  };

  const openingBalanceEquityAccount = accounts.find((a) => a.name === 'Opening Balance Equity');

  return (
    <div>
      <h3 style={styles.title}>Journal Entries</h3>
      <p style={styles.desc}>
        For adjustments, depreciation, accruals, and corrections that don't come from an uploaded document. Every entry
        is real double-entry — the lines must balance. Increases to expense accounts are entered as negative amounts,
        matching how expenses are stored everywhere else in this app.
      </p>

      <div style={{ display: 'flex', gap: spacing.sm, marginBottom: spacing.lg }}>
        <button onClick={() => setShowEntryModal(true)} style={button.primary}>+ New journal entry</button>
        <button onClick={() => setShowOpeningBalanceModal(true)} style={button.secondary}>+ Enter opening balances</button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={table.container}>
          <thead>
            <tr>
              <th style={table.headerCell}>Date</th>
              <th style={table.headerCell}>Description</th>
              <th style={table.headerCell}>Type</th>
              <th style={table.headerCell}>Lines</th>
              <th style={table.headerCell}></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="hoverable-row" style={{ ...table.row, verticalAlign: 'top' }}>
                <td style={table.cell}>{e.entry_date?.slice(0, 10)}</td>
                <td style={table.cell}>{e.description}</td>
                <td style={table.cell}>{e.entry_type}</td>
                <td style={table.cell}>
                  {e.lines.map((l) => (
                    <div key={l.id} style={{ fontFamily: fonts.mono, fontSize: fonts.sizeSm }}>{l.account_name}: {Number(l.amount).toFixed(2)}</div>
                  ))}
                </td>
                <td style={table.cell}>
                  <button onClick={() => setDeleteEntryId(e.id)} style={button.smallDanger}>Delete</button>
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr><td colSpan={5} style={{ ...table.cell, textAlign: 'center', color: colors.textSubtle, padding: spacing.xxl }}>No journal entries yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showEntryModal && (
        <JournalEntryModal accounts={accounts} onClose={() => setShowEntryModal(false)} onSubmit={(payload) => submitEntry(payload)} />
      )}
      {showOpeningBalanceModal && (
        <OpeningBalanceModal accounts={accounts} openingBalanceEquityAccountId={openingBalanceEquityAccount?.id} onClose={() => setShowOpeningBalanceModal(false)} onSubmit={(payload) => submitEntry(payload)} />
      )}
      {deleteEntryId && (
        <ConfirmDialog title="Delete journal entry" message="This removes all of its lines from the ledger. Are you sure?" confirmLabel="Delete" onConfirm={() => handleDelete(false)} onCancel={() => setDeleteEntryId(null)} />
      )}
      {lockOverridePrompt && (
        <ConfirmDialog title="Period is locked" message={`${lockOverridePrompt.message} As an admin, you can override this for this one action — it will be logged.`} confirmLabel="Override and proceed" onConfirm={() => lockOverridePrompt.retry()} onCancel={() => setLockOverridePrompt(null)} />
      )}
      {errorMessage && (
        <ConfirmDialog title="Couldn't save" message={errorMessage} confirmLabel="OK" danger={false} onConfirm={() => setErrorMessage(null)} onCancel={() => setErrorMessage(null)} />
      )}
    </div>
  );
}

function JournalEntryModal({ accounts, onClose, onSubmit }) {
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [entryType, setEntryType] = useState('adjustment');
  const [lines, setLines] = useState([{ account_id: '', amount: '' }, { account_id: '', amount: '' }]);

  const accountType = (id) => accounts.find((a) => a.id === id)?.account_type;
  const weight = (type) => (type === 'asset' ? 1 : -1);
  const weightedSum = lines.reduce((s, l) => s + weight(accountType(l.account_id)) * (Number(l.amount) || 0), 0);
  const balanced = Math.abs(weightedSum) < 0.01;

  const updateLine = (i, field, value) => {
    const next = [...lines];
    next[i] = { ...next[i], [field]: value };
    setLines(next);
  };

  const addLine = () => setLines([...lines, { account_id: '', amount: '' }]);
  const removeLine = (i) => setLines(lines.filter((_, idx) => idx !== i));

  const submit = () => {
    if (!description.trim() || lines.some((l) => !l.account_id || !l.amount)) return;
    if (!balanced) return;
    onSubmit({
      entry_date: entryDate, description, entry_type: entryType,
      lines: lines.map((l) => ({ account_id: l.account_id, amount: Number(l.amount) })),
    });
  };

  return (
    <Modal title="New journal entry" onClose={onClose} width={520}>
      <div style={{ display: 'flex', gap: spacing.sm, marginBottom: spacing.md }}>
        <label style={styles.fieldLabel}>
          Date
          <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} style={{ ...input.base, width: '100%', marginTop: spacing.xs }} />
        </label>
        <label style={styles.fieldLabel}>
          Type
          <select value={entryType} onChange={(e) => setEntryType(e.target.value)} style={{ ...select, width: '100%', marginTop: spacing.xs }}>
            {ENTRY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>
      <label style={styles.fieldLabel}>
        Description
        <input value={description} onChange={(e) => setDescription(e.target.value)} style={{ ...input.base, width: '100%', marginTop: spacing.xs }} />
      </label>

      <div style={{ marginTop: spacing.lg }}>
        <strong style={{ fontSize: fonts.sizeSm, color: colors.navy }}>Lines</strong>
        {lines.map((line, i) => (
          <div key={i} style={{ display: 'flex', gap: spacing.sm, marginTop: spacing.sm, alignItems: 'center' }}>
            <select value={line.account_id} onChange={(e) => updateLine(i, 'account_id', e.target.value)} style={{ ...select, flex: 1 }}>
              <option value="">Choose account…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.account_type})</option>)}
            </select>
            <input type="number" placeholder="Amount" value={line.amount} onChange={(e) => updateLine(i, 'amount', e.target.value)} style={{ ...input.base, width: 120 }} />
            {lines.length > 2 && (
              <button onClick={() => removeLine(i)} style={button.smallDanger}>&#215;</button>
            )}
          </div>
        ))}
        <button onClick={addLine} style={{ ...button.secondary, marginTop: spacing.sm, fontSize: fonts.sizeSm }}>+ Add line</button>
      </div>

      <p style={{ fontSize: fonts.sizeSm, marginTop: spacing.md, color: balanced ? colors.success : colors.error, fontWeight: fonts.weightMedium }}>
        {balanced ? '&#10003; Balanced' : `Not balanced — off by ${weightedSum.toFixed(2)}. Remember: expense increases are negative.`}
      </p>

      <button onClick={submit} disabled={!balanced} style={{ ...button.primary, marginTop: spacing.sm }}>Save entry</button>
    </Modal>
  );
}

function OpeningBalanceModal({ accounts, openingBalanceEquityAccountId, onClose, onSubmit }) {
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [balances, setBalances] = useState({});

  const relevantAccounts = accounts.filter((a) => a.name !== 'Opening Balance Equity' && a.account_type !== 'income' && a.account_type !== 'expense');

  const submit = () => {
    const lines = Object.entries(balances)
      .filter(([, amount]) => amount !== '' && amount !== undefined)
      .map(([account_id, amount]) => ({ account_id, amount: Number(amount) }));
    if (lines.length === 0 || !openingBalanceEquityAccountId) return;
    onSubmit({ entry_date: asOfDate, description: `Opening balances as of ${asOfDate}`, entry_type: 'opening_balance', lines, auto_balance_account_id: openingBalanceEquityAccountId });
  };

  return (
    <Modal title="Enter opening balances" onClose={onClose} width={480}>
      {!openingBalanceEquityAccountId && (
        <div style={{ ...alert.error, marginBottom: spacing.md }}>
          This business has no "Opening Balance Equity" account — it should have been added automatically. Contact support.
        </div>
      )}
      <label style={styles.fieldLabel}>
        As of date
        <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} style={{ ...input.base, width: '100%', marginTop: spacing.xs }} />
      </label>
      <p style={{ fontSize: fonts.sizeXs, color: colors.textMuted, marginTop: spacing.md }}>
        Enter the balance for each account you know (leave others blank). Assets and positive liability/equity balances
        are positive numbers. The Opening Balance Equity plug is calculated for you.
      </p>
      <div style={{ maxHeight: 320, overflowY: 'auto', marginTop: spacing.sm }}>
        {relevantAccounts.map((a) => (
          <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
            <label style={{ fontSize: fonts.sizeSm, color: colors.text }}>{a.name} <span style={{ color: colors.textSubtle }}>({a.account_type})</span></label>
            <input type="number" value={balances[a.id] || ''} onChange={(e) => setBalances({ ...balances, [a.id]: e.target.value })} style={{ ...input.base, width: 120 }} />
          </div>
        ))}
      </div>
      <button onClick={submit} style={{ ...button.primary, marginTop: spacing.md }}>Save opening balances</button>
    </Modal>
  );
}

const styles = {
  title: { fontSize: fonts.sizeLg, fontWeight: fonts.weightSemibold, color: colors.navy, margin: `0 0 ${spacing.xs}px` },
  desc: { fontSize: fonts.sizeSm, color: colors.textMuted, margin: `0 0 ${spacing.lg}px`, lineHeight: fonts.lineHeightBody },
  fieldLabel: { fontSize: fonts.sizeSm, fontWeight: fonts.weightMedium, color: colors.gray700, flex: 1, display: 'flex', flexDirection: 'column' },
};
