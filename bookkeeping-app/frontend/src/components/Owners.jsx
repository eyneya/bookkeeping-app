import { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';
import { colors, fonts, spacing, button, input, select, table, alert, badge } from '../theme';

export default function Owners({ clientId, customerId }) {
  const [owners, setOwners] = useState([]);
  const [name, setName] = useState('');
  const [ownerType, setOwnerType] = useState('partner');
  const [pct, setPct] = useState('');
  const [selectedOwnerId, setSelectedOwnerId] = useState(null);
  const [capitalReport, setCapitalReport] = useState(null);
  const [reportError, setReportError] = useState(null);
  const [capitalEntryModal, setCapitalEntryModal] = useState(null);

  const loadOwners = () => {
    apiFetch(`/api/owners?client_id=${clientId}`).then((r) => r.json()).then(setOwners);
  };
  useEffect(loadOwners, [clientId]);

  const addOwner = async () => {
    if (!name.trim() || !pct) return;
    await apiFetch('/api/owners', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, customer_id: customerId, owner_type: ownerType, ownership_percentage: Number(pct), name }),
    });
    setName('');
    setPct('');
    loadOwners();
  };

  const runCapitalReport = async () => {
    setReportError(null);
    const res = await apiFetch(`/api/reports/capital-accounts?client_id=${clientId}`);
    const data = await res.json();
    if (!res.ok) { setReportError(data.error); setCapitalReport(null); }
    else setCapitalReport(data);
  };

  const totalPct = owners.reduce((s, o) => s + Number(o.ownership_percentage), 0);

  return (
    <div>
      <h3 style={styles.title}>Owners</h3>
      <p style={{ fontSize: fonts.sizeSm, color: totalPct !== 100 && owners.length > 0 ? colors.error : colors.textMuted, marginBottom: spacing.lg }}>
        Total ownership: <strong>{totalPct}%</strong> {totalPct !== 100 && owners.length > 0 && '— should total 100%'}
      </p>

      <div style={{ overflowX: 'auto' }}>
        <table style={table.container}>
          <thead>
            <tr>
              <th style={table.headerCell}>Name</th>
              <th style={table.headerCell}>Type</th>
              <th style={table.headerCell}>Ownership %</th>
              <th style={table.headerCell}>Capital actions</th>
              <th style={table.headerCell}>Personal tier</th>
            </tr>
          </thead>
          <tbody>
            {owners.map((o) => (
              <tr key={o.id} className="hoverable-row" style={{ ...table.row, background: selectedOwnerId === o.id ? colors.infoBg : colors.white }}>
                <td style={{ ...table.cell, fontWeight: fonts.weightMedium }}>{o.name}</td>
                <td style={table.cell}>{o.owner_type}</td>
                <td style={table.cell}>{o.ownership_percentage}%</td>
                <td style={table.cell}>
                  <button onClick={() => setCapitalEntryModal({ ownerId: o.id, entryType: 'contribution' })} style={button.small}>+ Contribution</button>
                  <button onClick={() => setCapitalEntryModal({ ownerId: o.id, entryType: 'distribution' })} style={button.small}>+ Distribution</button>
                </td>
                <td style={table.cell}>
                  <button onClick={() => setSelectedOwnerId(selectedOwnerId === o.id ? null : o.id)} style={button.small}>
                    {selectedOwnerId === o.id ? 'Close' : 'Open personal tier'}
                  </button>
                </td>
              </tr>
            ))}
            {owners.length === 0 && (
              <tr><td colSpan={5} style={{ ...table.cell, textAlign: 'center', color: colors.textSubtle, padding: spacing.xxl }}>No owners yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: spacing.sm, marginBottom: spacing.sm, alignItems: 'center', flexWrap: 'wrap', marginTop: spacing.lg }}>
        <input placeholder="Owner name (only if different from client)" value={name} onChange={(e) => setName(e.target.value)} style={{ ...input.base, flex: 1, minWidth: 200 }} />
        <select value={ownerType} onChange={(e) => setOwnerType(e.target.value)} style={{ ...select, minWidth: 120 }}>
          <option value="partner">Partner</option>
          <option value="shareholder">Shareholder</option>
        </select>
        <input type="number" placeholder="Ownership %" value={pct} onChange={(e) => setPct(e.target.value)} style={{ ...input.base, width: 120 }} />
        <button onClick={addOwner} style={button.primary}>+ Add owner</button>
      </div>
      <p style={styles.note}>
        Use this to add a co-owner who is a DIFFERENT person than the client currently selected. The selected client is usually already an owner from when the business was created.
      </p>

      {selectedOwnerId && (
        <PersonalTier owner={owners.find((o) => o.id === selectedOwnerId)} onCrossReferenced={runCapitalReport} />
      )}

      <div style={styles.divider} />

      <button onClick={runCapitalReport} style={{ ...button.accent, marginBottom: spacing.md }}>Run Capital Accounts report</button>
      {reportError && <div style={{ ...alert.error, marginBottom: spacing.md }}>{reportError}</div>}
      {capitalReport && (
        <div style={{ overflowX: 'auto' }}>
          <table style={table.container}>
            <thead>
              <tr>
                <th style={table.headerCell}>Owner</th>
                <th style={table.headerCell}>Contributions</th>
                <th style={table.headerCell}>Distributions</th>
                <th style={table.headerCell}>Allocated Income/Loss</th>
                <th style={table.headerCell}>Ending Balance</th>
              </tr>
            </thead>
            <tbody>
              {capitalReport.owners.map((o) => (
                <tr key={o.owner_id} className="hoverable-row" style={table.row}>
                  <td style={table.cell}>{o.name}</td>
                  <td style={{ ...table.cell, fontFamily: fonts.mono }}>{o.contributions.toFixed(2)}</td>
                  <td style={{ ...table.cell, fontFamily: fonts.mono }}>{o.distributions.toFixed(2)}</td>
                  <td style={{ ...table.cell, fontFamily: fonts.mono }}>{o.allocated_income.toFixed(2)}</td>
                  <td style={{ ...table.cell, fontFamily: fonts.mono, fontWeight: fonts.weightSemibold }}>{o.ending_balance.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {capitalEntryModal && (
        <CapitalEntryModal
          entryType={capitalEntryModal.entryType}
          onClose={() => setCapitalEntryModal(null)}
          onSubmit={async (entryDate, amount) => {
            await apiFetch(`/api/owners/${capitalEntryModal.ownerId}/capital-entries`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ entry_date: entryDate, entry_type: capitalEntryModal.entryType, amount: Number(amount) }),
            });
            setCapitalEntryModal(null);
            runCapitalReport();
          }}
        />
      )}
    </div>
  );
}

function CapitalEntryModal({ entryType, onClose, onSubmit }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');

  return (
    <Modal title={entryType === 'contribution' ? 'Add contribution' : 'Add distribution'} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
        <label style={styles.fieldLabel}>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...input.base, width: '100%', marginTop: spacing.xs }} />
        </label>
        <label style={styles.fieldLabel}>
          Amount
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ ...input.base, width: '100%', marginTop: spacing.xs }} autoFocus />
        </label>
        <button onClick={() => amount && onSubmit(date, amount)} style={{ ...button.primary, marginTop: spacing.sm }}>Save</button>
      </div>
    </Modal>
  );
}

function PersonalTier({ owner, onCrossReferenced }) {
  const [transactions, setTransactions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [personalReport, setPersonalReport] = useState(null);
  const [aiProvider, setAiProvider] = useState('claude');
  const [flagModalTxnId, setFlagModalTxnId] = useState(null);
  const [unflagTxnId, setUnflagTxnId] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  const loadPersonalTxns = () => {
    apiFetch(`/api/customers/${owner.customer_id}/transactions`).then((r) => r.json()).then((data) => setTransactions(data.transactions || []));
    apiFetch(`/api/clients/${owner.client_id}`).then((r) => r.json()).then((c) => setAccounts(c.accounts || []));
  };
  useEffect(loadPersonalTxns, [owner.id]);

  const handleFiles = async (fileList, docType) => {
    setUploading(true);
    for (const file of Array.from(fileList)) {
      const form = new FormData();
      form.append('file', file);
      form.append('customer_id', owner.customer_id);
      form.append('doc_type', docType);
      form.append('ai_provider', aiProvider);
      await apiFetch('/api/documents/upload', { method: 'POST', body: form });
    }
    setUploading(false);
    loadPersonalTxns();
  };

  const setCategory = async (txnId, category) => {
    await apiFetch(`/api/transactions/${txnId}/personal-category`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personal_category: category }),
    });
    loadPersonalTxns();
  };

  const flagAsBusiness = async (txnId, accountId) => {
    const res = await apiFetch(`/api/transactions/${txnId}/flag-as-business-expense`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner_id: owner.id, account_id: accountId }),
    });
    setFlagModalTxnId(null);
    if (res.ok) { loadPersonalTxns(); onCrossReferenced(); }
    else { const data = await res.json(); setErrorMessage(data.error); }
  };

  const unflag = async () => {
    const res = await apiFetch(`/api/transactions/${unflagTxnId}/unflag-business-expense`, { method: 'POST' });
    setUnflagTxnId(null);
    if (res.ok) { loadPersonalTxns(); onCrossReferenced(); }
    else { const data = await res.json(); setErrorMessage(data.error); }
  };

  const runPersonalStatement = async () => {
    const res = await apiFetch(`/api/reports/personal-statement?owner_id=${owner.id}`);
    setPersonalReport(await res.json());
  };

  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, padding: spacing.xl, marginBottom: spacing.lg, marginTop: spacing.lg, background: colors.gray50 }}>
      <h4 style={styles.sectionTitle}>{owner.name}'s personal tier</h4>
      <p style={styles.note}>
        Shared across every business this person owns — transactions already claimed by another business are shown grayed out below.
      </p>

      <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center', marginBottom: spacing.md, flexWrap: 'wrap' }}>
        <label style={{ fontSize: fonts.sizeXs, color: colors.textMuted, fontWeight: fonts.weightMedium }}>Extraction engine:</label>
        <select value={aiProvider} onChange={(e) => setAiProvider(e.target.value)} style={{ ...select, fontSize: fonts.sizeXs }}>
          <option value="claude">Claude (JPG, PNG, PDF)</option>
          <option value="openai">ChatGPT / OpenAI (JPG, PNG only)</option>
        </select>
      </div>

      <div style={{ display: 'flex', gap: spacing.xl, marginBottom: spacing.lg, flexWrap: 'wrap' }}>
        <label style={{ fontSize: fonts.sizeSm, color: colors.text, cursor: 'pointer' }}>
          Upload personal bank statement(s):
          <input type="file" multiple accept="image/*,application/pdf" onChange={(e) => handleFiles(e.target.files, 'bank_statement')} style={{ display: 'block', marginTop: spacing.xs }} />
        </label>
        <label style={{ fontSize: fonts.sizeSm, color: colors.text, cursor: 'pointer' }}>
          Upload personal receipt(s):
          <input type="file" multiple accept="image/*,application/pdf" onChange={(e) => handleFiles(e.target.files, 'invoice')} style={{ display: 'block', marginTop: spacing.xs }} />
        </label>
      </div>
      {uploading && <div style={{ ...alert.info, marginBottom: spacing.md }}>Processing…</div>}

      <div style={{ overflowX: 'auto' }}>
        <table style={table.container}>
          <thead>
            <tr>
              <th style={table.headerCell}>Date</th>
              <th style={table.headerCell}>Description</th>
              <th style={table.headerCell}>Amount</th>
              <th style={table.headerCell}>Personal category</th>
              <th style={table.headerCell}>Cross-reference</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => {
              const claimedByOther = t.flagged_as_business && t.flagged_for_client_id !== owner.client_id;
              const claimedByThis = t.flagged_as_business && t.flagged_for_client_id === owner.client_id;
              return (
                <tr key={t.id} className="hoverable-row" style={{
                  ...table.row,
                  background: claimedByThis ? colors.successBg : claimedByOther ? colors.gray100 : colors.white,
                  color: claimedByOther ? colors.gray400 : colors.text,
                }}>
                  <td style={table.cell}>{t.txn_date?.slice(0, 10)}</td>
                  <td style={table.cell}>{t.description}</td>
                  <td style={{ ...table.cell, fontFamily: fonts.mono }}>{Number(t.amount).toFixed(2)}</td>
                  <td style={table.cell}>
                    <input
                      defaultValue={t.personal_category || ''}
                      placeholder="e.g. Groceries"
                      disabled={claimedByOther}
                      onBlur={(e) => e.target.value !== (t.personal_category || '') && setCategory(t.id, e.target.value)}
                      style={{ ...input.small, width: 120, opacity: claimedByOther ? 0.5 : 1 }}
                    />
                  </td>
                  <td style={table.cell}>
                    {claimedByOther && <span style={{ fontSize: fonts.sizeXs, color: colors.textMuted }}>Already claimed by {t.claimed_by_business_name}</span>}
                    {claimedByThis && (
                      <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center' }}>
                        <span style={{ ...badge.base, ...badge.success }}>&#10003; Flagged for this business</span>
                        <button onClick={() => setUnflagTxnId(t.id)} style={button.smallDanger}>Unflag</button>
                      </div>
                    )}
                    {!t.flagged_as_business && (
                      <button onClick={() => setFlagModalTxnId(t.id)} style={button.small}>Flag as business expense</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {transactions.length === 0 && (
              <tr><td colSpan={5} style={{ ...table.cell, textAlign: 'center', color: colors.textSubtle, padding: spacing.xxl }}>No personal transactions yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <button onClick={runPersonalStatement} style={{ ...button.secondary, marginTop: spacing.md, marginBottom: spacing.md }}>
        Run personal statement (this business)
      </button>
      {personalReport && (
        <div style={{ fontSize: fonts.sizeSm, background: colors.white, padding: spacing.lg, borderRadius: 6, border: `1px solid ${colors.border}` }}>
          <strong style={{ color: colors.navy }}>Business expenses covered personally: {personalReport.business_expenses_covered.total.toFixed(2)}</strong>
          <div style={{ margin: `${spacing.md}px 0` }}>
            <strong style={{ color: colors.navy }}>Full personal income/expense by category (all businesses):</strong>
            {personalReport.personal_statement.income.concat(personalReport.personal_statement.expenses).map((r) => (
              <div key={r.personal_category || 'uncategorized'} style={{ padding: `${spacing.xs}px 0`, fontFamily: fonts.mono }}>
                {r.personal_category || '(uncategorized)'}: {Number(r.total).toFixed(2)}
              </div>
            ))}
            <div style={{ fontWeight: fonts.weightSemibold, marginTop: spacing.sm }}>Net: {personalReport.personal_statement.net.toFixed(2)}</div>
          </div>
        </div>
      )}

      {flagModalTxnId && (
        <FlagAsBusinessModal
          accounts={accounts.filter((a) => a.account_type === 'expense')}
          ownerName={owner.name}
          onClose={() => setFlagModalTxnId(null)}
          onSubmit={(accountId) => flagAsBusiness(flagModalTxnId, accountId)}
        />
      )}
      {unflagTxnId && (
        <ConfirmDialog
          title="Unflag this transaction"
          message="This removes the business expense and capital contribution it created. Continue?"
          confirmLabel="Unflag"
          onConfirm={unflag}
          onCancel={() => setUnflagTxnId(null)}
        />
      )}
      {errorMessage && (
        <ConfirmDialog
          title="Action failed"
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

function FlagAsBusinessModal({ accounts, ownerName, onClose, onSubmit }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id || '');

  return (
    <Modal title={`Flag as business expense for ${ownerName}'s business`} onClose={onClose}>
      <label style={styles.fieldLabel}>
        Post to which expense account?
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={{ ...select, width: '100%', marginTop: spacing.xs }}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      <button onClick={() => accountId && onSubmit(accountId)} style={{ ...button.primary, marginTop: spacing.lg }}>Confirm</button>
    </Modal>
  );
}

const styles = {
  title: { fontSize: fonts.sizeLg, fontWeight: fonts.weightSemibold, color: colors.navy, margin: `0 0 ${spacing.lg}px` },
  sectionTitle: { fontSize: fonts.sizeMd, fontWeight: fonts.weightSemibold, color: colors.navy, margin: `0 0 ${spacing.xs}px` },
  note: { fontSize: fonts.sizeXs, color: colors.textSubtle, margin: `0 0 ${spacing.md}px` },
  divider: { borderTop: `1px solid ${colors.border}`, margin: `${spacing.xl}px 0` },
  fieldLabel: { fontSize: fonts.sizeSm, fontWeight: fonts.weightMedium, color: colors.gray700, display: 'flex', flexDirection: 'column' },
};
