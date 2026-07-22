import { useState } from 'react';
import { runReport, exportExcel } from '../api';
import { colors, fonts, spacing, button, input, select, table, alert } from '../theme';

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
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);

  const runReportHandler = async () => {
    setError(null);
    try {
      const result = await runReport(reportType, { client_id: clientId, start_date: startDate, end_date: endDate });
      setData(result);
    } catch (err) {
      setError(err.message);
      setData(null);
    }
  };

  const downloadExcel = async () => {
    setExporting(true);
    try {
      const blob = await exportExcel(clientId, startDate, endDate);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'eyneya-bookkeeping-export.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <h3 style={styles.title}>Reports</h3>
      <div style={{ display: 'flex', gap: spacing.sm, marginBottom: spacing.md, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={reportType} onChange={(e) => { setReportType(e.target.value); setData(null); }} style={{ ...select, minWidth: 220 }}>
          {Object.entries(REPORT_TYPES).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={input.base} />
        <span style={{ color: colors.textMuted, fontSize: fonts.sizeSm }}>to</span>
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={input.base} />
        <button onClick={runReportHandler} style={button.primary}>Run report</button>
      </div>

      <div style={{ display: 'flex', gap: spacing.sm, marginBottom: spacing.xl, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={downloadExcel} disabled={exporting} style={button.secondary}>
          {exporting ? 'Generating…' : 'Download full Excel workbook'}
        </button>
      </div>

      {error && <div style={{ ...alert.error, marginBottom: spacing.lg }}>{error}</div>}

      {data && reportType === 'pl' && <PLView data={data} />}
      {data && reportType === 'balance-sheet' && <BalanceSheetView data={data} />}
      {data && reportType === 'general-ledger' && <GeneralLedgerView data={data} />}
      {data && reportType === 'capital-accounts' && <CapitalAccountsView data={data} />}
    </div>
  );
}

function ReportSection({ title, rows }) {
  if (!rows || rows.length === 0) return null;
  return (
    <>
      <h4 style={styles.sectionTitle}>{title}</h4>
      {rows.map((r) => (
        <div key={r.account_name} style={styles.reportLine}>
          <span style={styles.reportLabel}>{r.account_name}</span>
          <span style={styles.reportValue}>{Number(r.total).toFixed(2)}</span>
        </div>
      ))}
    </>
  );
}

function CapitalAccountsView({ data }) {
  if (data.error) return <div style={alert.error}>{data.error}</div>;
  const owners = Array.isArray(data.owners) ? data.owners : [];
  if (data.ownership_warning) {
    return <div style={{ ...alert.warning, marginBottom: spacing.md }}>{data.ownership_warning}</div>;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={table.container}>
        <thead>
          <tr>
            <th style={table.headerCell}>Owner</th>
            <th style={table.headerCell}>Ownership %</th>
            <th style={table.headerCell}>Contributions</th>
            <th style={table.headerCell}>Distributions</th>
            <th style={table.headerCell}>Allocated Income/Loss</th>
            <th style={table.headerCell}>Ending Balance</th>
          </tr>
        </thead>
        <tbody>
          {owners.map((o) => (
            <tr key={o.owner_id} className="hoverable-row" style={table.row}>
              <td style={table.cell}>{o.name}</td>
              <td style={table.cell}>{o.ownership_percentage}%</td>
              <td style={{ ...table.cell, fontFamily: fonts.mono }}>{Number(o.contributions).toFixed(2)}</td>
              <td style={{ ...table.cell, fontFamily: fonts.mono }}>{Number(o.distributions).toFixed(2)}</td>
              <td style={{ ...table.cell, fontFamily: fonts.mono }}>{Number(o.allocated_income).toFixed(2)}</td>
              <td style={{ ...table.cell, fontFamily: fonts.mono, fontWeight: fonts.weightSemibold }}>{Number(o.ending_balance).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PLView({ data }) {
  if (!Array.isArray(data)) return <div style={alert.error}>Unexpected data format</div>;
  const income = data.filter((r) => r.account_type === 'income');
  const expenses = data.filter((r) => r.account_type === 'expense');
  const totalIncome = income.reduce((s, r) => s + Number(r.total), 0);
  const totalExpenses = expenses.reduce((s, r) => s + Number(r.total), 0);
  return (
    <div>
      <ReportSection title="Income" rows={income} />
      <ReportSection title="Expenses" rows={expenses} />
      <div style={{ ...styles.reportLine, borderTop: `2px solid ${colors.navy}`, marginTop: spacing.md, paddingTop: spacing.md }}>
        <span style={{ ...styles.reportLabel, fontWeight: fonts.weightBold, color: colors.navy }}>Net income</span>
        <span style={{ ...styles.reportValue, fontWeight: fonts.weightBold, color: colors.navy, fontFamily: fonts.mono }}>{(totalIncome + totalExpenses).toFixed(2)}</span>
      </div>
    </div>
  );
}

function BalanceSheetView({ data }) {
  if (!Array.isArray(data)) return <div style={alert.error}>Unexpected data format</div>;
  const assets = data.filter((r) => r.account_type === 'asset');
  const liabilities = data.filter((r) => r.account_type === 'liability');
  const equity = data.filter((r) => r.account_type === 'equity');
  return (
    <div>
      <ReportSection title="Assets" rows={assets} />
      <ReportSection title="Liabilities" rows={liabilities} />
      <ReportSection title="Equity" rows={equity} />
    </div>
  );
}

function GeneralLedgerView({ data }) {
  if (!Array.isArray(data)) return <div style={alert.error}>Unexpected data format</div>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={table.container}>
        <thead>
          <tr>
            <th style={table.headerCell}>Date</th>
            <th style={table.headerCell}>Description</th>
            <th style={table.headerCell}>Account</th>
            <th style={table.headerCell}>Business?</th>
            <th style={table.headerCell}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => (
            <tr key={i} className="hoverable-row" style={table.row}>
              <td style={table.cell}>{r.txn_date?.slice(0, 10)}</td>
              <td style={table.cell}>{r.description}</td>
              <td style={table.cell}>{r.account_name || '—'}</td>
              <td style={table.cell}>{r.is_business === null ? '—' : r.is_business ? 'Business' : 'Personal'}</td>
              <td style={{ ...table.cell, fontFamily: fonts.mono }}>{Number(r.amount).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const styles = {
  title: { fontSize: fonts.sizeLg, fontWeight: fonts.weightSemibold, color: colors.navy, margin: `0 0 ${spacing.lg}px` },
  sectionTitle: { fontSize: fonts.sizeMd, fontWeight: fonts.weightSemibold, color: colors.navy, margin: `${spacing.lg}px 0 ${spacing.sm}px` },
  reportLine: { display: 'flex', justifyContent: 'space-between', padding: `${spacing.xs}px 0`, borderBottom: `1px solid ${colors.borderLight}` },
  reportLabel: { fontSize: fonts.sizeBase, color: colors.text },
  reportValue: { fontSize: fonts.sizeBase, color: colors.text, fontFamily: fonts.mono },
};
