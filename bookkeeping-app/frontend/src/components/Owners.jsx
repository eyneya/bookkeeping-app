import { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';

export default function Owners({ clientId, customerId }) {
  const [owners, setOwners] = useState([]);
  const [name, setName] = useState('');
  const [ownerType, setOwnerType] = useState('partner');
  const [pct, setPct] = useState('');
  const [selectedOwnerId, setSelectedOwnerId] = useState(null);
  const [capitalReport, setCapitalReport] = useState(null);
  const [reportError, setReportError] = useState(null);
  const [capitalEntryModal, setCapitalEntryModal] = useState(null); // { ownerId, entryType }

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
    if (!res.ok) {
      setReportError(data.error);
      setCapitalReport(null);
    } else {
      setCapitalReport(data);
    }
  };

  const totalPct = owners.reduce((s, o) => s + Number(o.ownership_percentage), 0);

  return (
    <div>
      <h3>Owners</h3>
      <p style={{ fontSize: 13, color: totalPct !== 100 && owners.length > 0 ? '#dc2626' : '#666' }}>
        Total ownership: {totalPct}% {totalPct !== 100 && owners.length > 0 ? '— should total 100%' : ''}
      </p>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginBottom: 16 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
            <th style={cell}>Name</th>
            <th style={cell}>Type</th>
            <th style={cell}>Ownership %</th>
            <th style={cell}>Capital actions</th>
            <th style={cell}>Personal tier</th>
          </tr>
        </thead>
        <tbody>
          {owners.map((o) => (
            <tr key={o.id} style={{ borderBottom: '1px solid #f0f0f0', background: selectedOwnerId === o.id ? '#eff6ff' : 'white' }}>
              <td style={cell}>{o.name}</td>
              <td style={cell}>{o.owner_type}</td>
              <td style={cell}>{o.ownership_percentage}%</td>
              <td style={cell}>
                <button onClick={() => setCapitalEntryModal({ ownerId: o.id, entryType: 'contribution' })} style={btn}>+ Contribution</button>
                <button onClick={() => setCapitalEntryModal({ ownerId: o.id, entryType: 'distribution' })} style={btn}>+ Distribution</button>
              </td>
              <td style={cell}>
                <button onClick={() => setSelectedOwnerId(selectedOwnerId === o.id ? null : o.id)} style={btn}>
                  {selectedOwnerId === o.id ? 'Close' : 'Open personal tier'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
        <input placeholder="Owner name (only if different from client name)" value={name} onChange={(e) => setName(e.target.value)} style={{ ...input, width: 260 }} />
        <select value={ownerType} onChange={(e) => setOwnerType(e.target.value)} style={input}>
          <option value="partner">Partner</option>
          <option value="shareholder">Shareholder</option>
        </select>
        <input
          placeholder="Ownership %"
          type="number"
          value={pct}
          onChange={(e) => setPct(e.target.value)}
          style={{ ...input, width: 100 }}
        />
        <button onClick={addOwner} style={{ padding: '8px 12px', cursor: 'pointer' }}>+ Add owner</button>
      </div>
      <p style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>
        Use this to add a co-owner who is a DIFFERENT person than the client currently selected (e.g. a business partner).
        The currently selected client is usually already an owner here from when the business was created.
      </p>

      {selectedOwnerId && (
        <PersonalTier owner={owners.find((o) => o.id === selectedOwnerId)} onCrossReferenced={runCapitalReport} />
      )}

      <hr style={{ margin: '24px 0' }} />

      <button onClick={runCapitalReport} style={{ padding: '8px 12px', cursor: 'pointer', marginBottom: 12 }}>
        Run Capital Accounts report
      </button>
      {reportError && <p style={{ color: '#dc2626', fontSize: 13 }}>{reportError}</p>}
      {capitalReport && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
              <th style={cell}>Owner</th>
              <th style={cell}>Contributions</th>
              <th style={cell}>Distributions</th>
              <th style={cell}>Allocated Income/Loss</th>
              <th style={cell}>Ending Balance</th>
            </tr>
          </thead>
          <tbody>
            {capitalReport.owners.map((o) => (
              <tr key={o.owner_id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={cell}>{o.name}</td>
                <td style={cell}>{o.contributions.toFixed(2)}</td>
                <td style={cell}>{o.distributions.toFixed(2)}</td>
                <td style={cell}>{o.allocated_income.toFixed(2)}</td>
                <td style={cell}>{o.ending_balance.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ fontSize: 13 }}>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...input, width: '100%', marginTop: 4 }} />
        </label>
        <label style={{ fontSize: 13 }}>
          Amount
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ ...input, width: '100%', marginTop: 4 }} autoFocus />
        </label>
        <button
          onClick={() => amount && onSubmit(date, amount)}
          style={{ padding: '8px 12px', cursor: 'pointer', marginTop: 8 }}
        >
          Save
        </button>
      </div>
    </Modal>
  );
}

/**
 * The per-owner "personal tier". Documents/transactions here belong to the
 * OWNER'S CUSTOMER RECORD (the person), not this business specifically —
 * so if this same person owns a second business, the exact same personal
 * transactions show up there too, each one showing whether ANOTHER
 * business has already claimed it.
 */
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

  const handleFiles = async (fileList, docType, aiProvider = 'claude') => {
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
    if (res.ok) {
      loadPersonalTxns();
      onCrossReferenced();
    } else {
      const data = await res.json();
      setErrorMessage(data.error);
    }
  };

  const unflag = async () => {
    const res = await apiFetch(`/api/transactions/${unflagTxnId}/unflag-business-expense`, { method: 'POST' });
    setUnflagTxnId(null);
    if (res.ok) {
      loadPersonalTxns();
      onCrossReferenced();
    } else {
      const data = await res.json();
      setErrorMessage(data.error);
    }
  };

  const runPersonalStatement = async () => {
    const res = await apiFetch(`/api/reports/personal-statement?owner_id=${owner.id}`);
    setPersonalReport(await res.json());
  };

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <h4>{owner.name}'s personal tier</h4>
      <p style={{ fontSize: 12, color: '#888' }}>
        Shared across every business this person owns — transactions already claimed by another business are shown grayed out below.
      </p>

      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: '#666', marginRight: 8 }}>Extraction engine:</label>
        <select value={aiProvider} onChange={(e) => setAiProvider(e.target.value)} style={{ padding: 4, fontSize: 12 }}>
          <option value="claude">Claude (JPG, PNG, PDF)</option>
          <option value="openai">ChatGPT / OpenAI (JPG, PNG only)</option>
        </select>
      </div>

      <div style={{ display: 'flex', gap: 24, marginBottom: 16 }}>
        <label>
          Upload personal bank statement(s):
          <input type="file" multiple accept="image/*,application/pdf" onChange={(e) => handleFiles(e.target.files, 'bank_statement', aiProvider)} />
        </label>
        <label>
          Upload personal receipt(s):
          <input type="file" multiple accept="image/*,application/pdf" onChange={(e) => handleFiles(e.target.files, 'invoice', aiProvider)} />
        </label>
      </div>
      {uploading && <p>Processing…</p>}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 16 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
            <th style={cell}>Date</th>
            <th style={cell}>Description</th>
            <th style={cell}>Amount</th>
            <th style={cell}>Personal category</th>
            <th style={cell}>Cross-reference</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => {
            const claimedByOther = t.flagged_as_business && t.flagged_for_client_id !== owner.client_id;
            const claimedByThis = t.flagged_as_business && t.flagged_for_client_id === owner.client_id;
            return (
              <tr
                key={t.id}
                style={{
                  borderBottom: '1px solid #f0f0f0',
                  background: claimedByThis ? '#ecfdf5' : claimedByOther ? '#f3f4f6' : 'white',
                  color: claimedByOther ? '#999' : 'inherit',
                }}
              >
                <td style={cell}>{t.txn_date?.slice(0, 10)}</td>
                <td style={cell}>{t.description}</td>
                <td style={cell}>{Number(t.amount).toFixed(2)}</td>
                <td style={cell}>
                  <input
                    defaultValue={t.personal_category || ''}
                    placeholder="e.g. Groceries"
                    disabled={claimedByOther}
                    onBlur={(e) => e.target.value !== (t.personal_category || '') && setCategory(t.id, e.target.value)}
                    style={{ padding: 4, fontSize: 13, width: 120 }}
                  />
                </td>
                <td style={cell}>
                  {claimedByOther && <span>Already claimed by {t.claimed_by_business_name}</span>}
                  {claimedByThis && (
                    <>
                      <span style={{ color: '#16a34a', marginRight: 8 }}>✓ Flagged for this business</span>
                      <button onClick={() => setUnflagTxnId(t.id)} style={btn}>Unflag</button>
                    </>
                  )}
                  {!t.flagged_as_business && (
                    <button onClick={() => setFlagModalTxnId(t.id)} style={btn}>Flag as business expense</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <button onClick={runPersonalStatement} style={{ padding: '8px 12px', cursor: 'pointer', marginBottom: 12 }}>
        Run personal statement (this business)
      </button>
      {personalReport && (
        <div style={{ fontSize: 13 }}>
          <strong>Business expenses covered personally: {personalReport.business_expenses_covered.total.toFixed(2)}</strong>
          <div style={{ margin: '8px 0' }}>
            <strong>Full personal income/expense by category (all businesses):</strong>
            {personalReport.personal_statement.income.concat(personalReport.personal_statement.expenses).map((r) => (
              <div key={r.personal_category || 'uncategorized'}>
                {r.personal_category || '(uncategorized)'}: {Number(r.total).toFixed(2)}
              </div>
            ))}
            <div>Net: {personalReport.personal_statement.net.toFixed(2)}</div>
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
      <label style={{ fontSize: 13 }}>
        Post to which expense account?
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={{ ...input, width: '100%', marginTop: 4 }}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </label>
      <button onClick={() => accountId && onSubmit(accountId)} style={{ padding: '8px 12px', cursor: 'pointer', marginTop: 16 }}>
        Confirm
      </button>
    </Modal>
  );
}

const cell = { padding: '8px 6px' };
const input = { padding: 8, fontSize: 14 };
const btn = { marginRight: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer' };
