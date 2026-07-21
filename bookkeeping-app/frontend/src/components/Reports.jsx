import { useState } from 'react';
import { apiFetch } from '../api';

const REPORT_TYPES = {
  pl: 'Profit & Loss',
  'balance-sheet': 'Balance Sheet',
  'general-ledger': 'General Ledger',
  'capital-accounts': 'Capital Accounts (Partnership/S-Corp)',
};

export default function Reports({ clientId }) {
  const [reportType, setReportType] = useState('pl');
  const [data, setData] = useState(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const runReport = async () => {
    const params = new URLSearchParams({ client_id: clientId });
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    const res = await apiFetch(`/api/reports/${reportType}?${params}`);
    setData(await res.json());
  };

  // Auth headers can't be sent via a plain navigation/window.location, so
  // the download goes through apiFetch and gets turned into a blob link.
  const downloadExcel = async () => {
    const params = new URLSearchParams({ client_id: clientId });
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    const res = await apiFetch(`/api/reports/export?${params}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bookkeeping-export.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

  const [uploadStatus, setUploadStatus] = useState(null);
  const uploadToStorage = async () => {
    setUploadStatus('Uploading…');
    const res = await apiFetch('/api/reports/export-to-storage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, start_date: startDate || undefined, end_date: endDate || undefined }),
    });
    const data = await res.json();
    setUploadStatus(res.ok ? `Uploaded — saved to client's folder.` : `Failed: ${data.error}`);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 8, alignItems: 'center' }}>
        <select value={reportType} onChange={(e) => { setReportType(e.target.value); setData(null); }}>
          {Object.entries(REPORT_TYPES).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <span>to</span>
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        <button onClick={runReport} style={{ padding: '8px 12px', cursor: 'pointer' }}>Run report</button>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <button onClick={downloadExcel} style={{ padding: '8px 12px', cursor: 'pointer' }}>
          Download full Excel workbook
        </button>
        <button onClick={uploadToStorage} style={{ padding: '8px 12px', cursor: 'pointer' }}>
          Save Excel to client's Drive/OneDrive folder
        </button>
        {uploadStatus && <span style={{ fontSize: 13, color: '#666' }}>{uploadStatus}</span>}
      </div>

      {data && reportType === 'pl' && <PLView data={data} />}
      {data && reportType === 'balance-sheet' && <BalanceSheetView data={data} />}
      {data && reportType === 'general-ledger' && <GeneralLedgerView data={data} />}
      {data && reportType === 'capital-accounts' && <CapitalAccountsView data={data} />}
    </div>
  );
}

function CapitalAccountsView({ data }) {
  if (data.error) return <p style={{ color: '#dc2626' }}>{data.error}</p>;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr><th>Owner</th><th>Ownership %</th><th>Contributions</th><th>Distributions</th><th>Allocated Income/Loss</th><th>Ending Balance</th></tr>
      </thead>
      <tbody>
        {data.owners.map((o) => (
          <tr key={o.owner_id}>
            <td>{o.name}</td>
            <td>{o.ownership_percentage}%</td>
            <td>{o.contributions.toFixed(2)}</td>
            <td>{o.distributions.toFixed(2)}</td>
            <td>{o.allocated_income.toFixed(2)}</td>
            <td>{o.ending_balance.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PLView({ data }) {
  return (
    <div>
      <h3>Income</h3>
      {data.income.map((r) => <div key={r.account_name}>{r.account_name}: {Number(r.total).toFixed(2)}</div>)}
      <h3>Expenses</h3>
      {data.expenses.map((r) => <div key={r.account_name}>{r.account_name}: {Number(r.total).toFixed(2)}</div>)}
      <hr />
      <strong>Net income: {Number(data.net_income).toFixed(2)}</strong>
    </div>
  );
}

function BalanceSheetView({ data }) {
  return (
    <div>
      <h3>Assets</h3>
      {data.assets.map((r) => <div key={r.account_name}>{r.account_name}: {Number(r.total).toFixed(2)}</div>)}
      <h3>Liabilities</h3>
      {data.liabilities.map((r) => <div key={r.account_name}>{r.account_name}: {Number(r.total).toFixed(2)}</div>)}
      <h3>Equity</h3>
      {data.equity.map((r) => <div key={r.account_name}>{r.account_name}: {Number(r.total).toFixed(2)}</div>)}
    </div>
  );
}

function GeneralLedgerView({ data }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr><th>Date</th><th>Description</th><th>Account</th><th>Business?</th><th>Amount</th></tr>
      </thead>
      <tbody>
        {data.map((r, i) => (
          <tr key={i}>
            <td>{r.txn_date?.slice(0, 10)}</td>
            <td>{r.description}</td>
            <td>{r.account_name || '—'}</td>
            <td>{r.is_business === null ? '—' : r.is_business ? 'Business' : 'Personal'}</td>
            <td>{Number(r.amount).toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
