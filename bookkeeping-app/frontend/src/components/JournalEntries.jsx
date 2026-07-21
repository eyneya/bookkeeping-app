import { useEffect, useState } from 'react';
import { apiFetch, getCurrentUser } from '../api';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';

const ENTRY_TYPES = ['opening_balance', 'depreciation', 'accrual', 'correction', 'adjustment', 'other'];

export default function JournalEntries({ clientId }) {
  const [entries, setEntries] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [showOpeningBalanceModal, setShowOpeningBalanceModal] = useState(false);
  const [deleteEntryId, setDeleteEntryId] = useState(null);
  const [lockOverridePrompt, setLockOverridePrompt] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const isAdmin = getCurrentUser()?.role === 'admin';

  const load = () => {
    apiFetch(`/api/journal-entries?client_id=${clientId}`).then((r) => r.json()).then(setEntries);
    apiFetch(`/api/clients/${clientId}`).then((r) => r.json()).then((c) => setAccounts(c.accounts || []));
  };
  useEffect(load, [clientId]);

  const isLockError = (message) => message && message.toLowerCase().includes('locked period');

  const createEntry = async (payload, override) => {
    const res = await apiFetch('/api/journal-entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, ...payload, ...(override ? { override_lock: true } : {}) }),
    });
    if (res.ok) {
      setShowEntryModal(false);
      setShowOpeningBalanceModal(false);
      setLockOverridePrompt(null);
      load();
    } else {
      const data = await res.json();
      if (isAdmin && isLockError(data.error)) {
        setLockOverridePrompt({ message: data.error, retry: () => createEntry(payload, true) });
      } else {
        setErrorMessage(data.error);
      }
    }
  };

  const deleteEntry = async (override) => {
    const params = override ? '?override_lock=true' : '';
    const res = await apiFetch(`/api/journal-entries/${deleteEntryId}${params}`, { method: 'DELETE' });
    if (res.ok) {
      setDeleteEntryId(null);
      setLockOverridePrompt(null);
      load();
    } else {
      const data = await res.json();
      if (isAdmin && isLockError(data.error)) {
        setLockOverridePrompt({ message: data.error, retry: () => deleteEntry(true) });
      } else {
        setErrorMessage(data.error);
        setDeleteEntryId(null);
      }
    }
  };

  const openingBalanceEquityAccount = accounts.find((a) => a.name === 'Opening Balance Equity');

  return (
    <div>
      <h3>Journal Entries</h3>
      <p style={{ fontSize: 12, color: '#888' }}>
        For adjustments, depreciation, accruals, and corrections that don't come from an uploaded document. Every entry
        is real double-entry — the lines must balance. Increases to expense accounts are entered as negative amounts,
        matching how expenses are stored everywhere else in this app.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button onClick={() => setShowEntryModal(true)} style={{ padding: '8px 12px', cursor: 'pointer' }}>
          + New journal entry
        </button>
        <button onClick={() => setShowOpeningBalanceModal(true)} style={{ padding: '8px 12px', cursor: 'pointer' }}>
          + Enter opening balances
        </button>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
            <th style={cell}>Date</th>
            <th style={cell}>Description</th>
            <th style={cell}>Type</th>
            <th style={cell}>Lines</th>
            <th style={cell}></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} style={{ borderBottom: '1px solid #f0f0f0', verticalAlign: 'top' }}>
              <td style={cell}>{e.entry_date?.slice(0, 10)}</td>
              <td style={cell}>{e.description}</td>
              <td style={cell}>{e.entry_type}</td>
              <td style={cell}>
                {e.lines.map((l) => (
                  <div key={l.id}>{l.account_name}: {Number(l.amount).toFixed(2)}</div>
                ))}
              </td>
              <td style={cell}>
                <button onClick={() => setDeleteEntryId(e.id)} style={{ fontSize: 12, cursor: 'pointer', color: '#dc2626' }}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr><td colSpan={5} style={{ ...cell, color: '#888' }}>No journal entries yet.</td></tr>
          )}
        </tbody>
      </table>

      {showEntryModal && (
        <JournalEntryModal
          accounts={accounts}
          onClose={() => setShowEntryModal(false)}
          onSubmit={(payload) => createEntry(payload)}
        />
      )}
      {showOpeningBalanceModal && (
        <OpeningBalanceModal
          accounts={accounts}
          openingBalanceEquityAccountId={openingBalanceEquityAccount?.id}
          onClose={() => setShowOpeningBalanceModal(false)}
          onSubmit={(payload) => createEntry(payload)}
        />
      )}
      {deleteEntryId && (
        <ConfirmDialog
          title="Delete journal entry"
          message="This removes all of its lines from the ledger. Are you sure?"
          confirmLabel="Delete"
          onConfirm={() => deleteEntry(false)}
          onCancel={() => setDeleteEntryId(null)}
        />
      )}
      {lockOverridePrompt && (
        <ConfirmDialog
          title="Period is locked"
          message={`${lockOverridePrompt.message} As an admin, you can override this for this one action — it will be logged.`}
          confirmLabel="Override and proceed"
          onConfirm={() => lockOverridePrompt.retry()}
          onCancel={() => setLockOverridePrompt(null)}
        />
      )}
      {errorMessage && (
        <ConfirmDialog
          title="Couldn't save"
          message={errorMessage}
          confirmLabel="OK"
          danger={false}
          onConfirm={() => setErrorMessage(null)}
          onCancel={() => setErrorMessage(null)}
        />
      )}
    </div>
  );
}

/** General-purpose manual journal entry: any number of lines, must balance to zero (weighted). */
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
      entry_date: entryDate,
      description,
      entry_type: entryType,
      lines: lines.map((l) => ({ account_id: l.account_id, amount: Number(l.amount) })),
    });
  };

  return (
    <Modal title="New journal entry" onClose={onClose} width={520}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <label style={{ fontSize: 13, flex: 1 }}>
          Date
          <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} style={{ ...input, width: '100%', marginTop: 4 }} />
        </label>
        <label style={{ fontSize: 13, flex: 1 }}>
          Type
          <select value={entryType} onChange={(e) => setEntryType(e.target.value)} style={{ ...input, width: '100%', marginTop: 4 }}>
            {ENTRY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>
      <label style={{ fontSize: 13 }}>
        Description
        <input value={description} onChange={(e) => setDescription(e.target.value)} style={{ ...input, width: '100%', marginTop: 4 }} />
      </label>

      <div style={{ marginTop: 16 }}>
        <strong style={{ fontSize: 13 }}>Lines</strong>
        {lines.map((line, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
            <select value={line.account_id} onChange={(e) => updateLine(i, 'account_id', e.target.value)} style={{ ...input, flex: 1 }}>
              <option value="">Choose account…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.account_type})</option>)}
            </select>
            <input
              type="number"
              placeholder="Amount"
              value={line.amount}
              onChange={(e) => updateLine(i, 'amount', e.target.value)}
              style={{ ...input, width: 120 }}
            />
            {lines.length > 2 && (
              <button onClick={() => removeLine(i)} style={{ cursor: 'pointer', color: '#dc2626', border: 'none', background: 'none' }}>×</button>
            )}
          </div>
        ))}
        <button onClick={addLine} style={{ marginTop: 8, fontSize: 12, cursor: 'pointer' }}>+ Add line</button>
      </div>

      <p style={{ fontSize: 12, marginTop: 12, color: balanced ? '#16a34a' : '#dc2626' }}>
        {balanced ? 'Balanced' : `Not balanced — off by ${weightedSum.toFixed(2)}. Remember: expense increases are negative.`}
      </p>

      <button onClick={submit} disabled={!balanced} style={{ padding: '8px 12px', cursor: balanced ? 'pointer' : 'default', marginTop: 8, opacity: balanced ? 1 : 0.5 }}>
        Save entry
      </button>
    </Modal>
  );
}

/**
 * Opening balances quick-entry: enter your actual account balances as of a
 * date, and the Opening Balance Equity plug is computed automatically so
 * the entry balances without you needing to know historical retained earnings.
 */
function OpeningBalanceModal({ accounts, openingBalanceEquityAccountId, onClose, onSubmit }) {
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [balances, setBalances] = useState({});

  const relevantAccounts = accounts.filter((a) => a.name !== 'Opening Balance Equity' && a.account_type !== 'income' && a.account_type !== 'expense');

  const submit = () => {
    const lines = Object.entries(balances)
      .filter(([, amount]) => amount !== '' && amount !== undefined)
      .map(([account_id, amount]) => ({ account_id, amount: Number(amount) }));
    if (lines.length === 0 || !openingBalanceEquityAccountId) return;
    onSubmit({
      entry_date: asOfDate,
      description: `Opening balances as of ${asOfDate}`,
      entry_type: 'opening_balance',
      lines,
      auto_balance_account_id: openingBalanceEquityAccountId,
    });
  };

  return (
    <Modal title="Enter opening balances" onClose={onClose} width={480}>
      {!openingBalanceEquityAccountId && (
        <p style={{ fontSize: 13, color: '#dc2626' }}>
          This business has no "Opening Balance Equity" account — it should have been added automatically. Contact support.
        </p>
      )}
      <label style={{ fontSize: 13 }}>
        As of date
        <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} style={{ ...input, width: '100%', marginTop: 4 }} />
      </label>
      <p style={{ fontSize: 12, color: '#888', marginTop: 12 }}>
        Enter the balance for each account you know (leave others blank). Assets and positive liability/equity balances
        are positive numbers. The Opening Balance Equity plug is calculated for you.
      </p>
      <div style={{ maxHeight: 320, overflowY: 'auto', marginTop: 8 }}>
        {relevantAccounts.map((a) => (
          <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <label style={{ fontSize: 13 }}>{a.name} <span style={{ color: '#888' }}>({a.account_type})</span></label>
            <input
              type="number"
              value={balances[a.id] || ''}
              onChange={(e) => setBalances({ ...balances, [a.id]: e.target.value })}
              style={{ ...input, width: 120 }}
            />
          </div>
        ))}
      </div>
      <button onClick={submit} style={{ padding: '8px 12px', cursor: 'pointer', marginTop: 12 }}>
        Save opening balances
      </button>
    </Modal>
  );
}

const cell = { padding: '8px 6px' };
const input = { padding: 8, fontSize: 14 };
