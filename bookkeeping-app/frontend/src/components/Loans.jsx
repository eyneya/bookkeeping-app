import { useEffect, useState } from 'react';
import { listLoans, createLoan, runReport } from '../api';
import { colors, fonts, spacing, button, input, table, alert } from '../theme';

export default function Loans({ clientId }) {
  const [loans, setLoans] = useState([]);
  const [selectedLoanId, setSelectedLoanId] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [form, setForm] = useState({ lender_name: '', original_principal: '', annual_interest_rate: '', origination_date: '', term_months: '60' });

  const load = () => { listLoans(clientId).then(setLoans); };
  useEffect(load, [clientId]);

  const addLoan = async () => {
    if (!form.lender_name.trim() || !form.original_principal || !form.origination_date) return;
    await createLoan({
      client_id: clientId,
      lender_name: form.lender_name,
      original_principal: Number(form.original_principal),
      annual_interest_rate: Number(form.annual_interest_rate),
      origination_date: form.origination_date,
      term_months: Number(form.term_months),
    });
    setForm({ lender_name: '', original_principal: '', annual_interest_rate: '', origination_date: '', term_months: '60' });
    load();
  };

  const viewSchedule = async (loanId) => {
    if (selectedLoanId === loanId) {
      setSelectedLoanId(null);
      setSchedule(null);
      return;
    }
    setSelectedLoanId(loanId);
    const data = await runReport('loan-amortization', { loan_id: loanId });
    setSchedule(data);
  };

  return (
    <div>
      <h3 style={styles.title}>Loans</h3>
      <div style={{ ...alert.info, marginBottom: spacing.lg }}>
        Standard fixed-rate amortization. Does not handle variable rates, balloon payments, or interest-only periods.
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={table.container}>
          <thead>
            <tr>
              <th style={table.headerCell}>Lender</th>
              <th style={table.headerCell}>Principal</th>
              <th style={table.headerCell}>Rate</th>
              <th style={table.headerCell}>Term</th>
              <th style={table.headerCell}>Schedule</th>
            </tr>
          </thead>
          <tbody>
            {loans.map((l) => (
              <tr key={l.id} className="hoverable-row" style={table.row}>
                <td style={{ ...table.cell, fontWeight: fonts.weightMedium }}>{l.lender_name}</td>
                <td style={{ ...table.cell, fontFamily: fonts.mono }}>{Number(l.original_principal).toFixed(2)}</td>
                <td style={table.cell}>{l.annual_interest_rate}%</td>
                <td style={table.cell}>{l.term_months} mo</td>
                <td style={table.cell}>
                  <button onClick={() => viewSchedule(l.id)} style={button.small}>
                    {selectedLoanId === l.id ? 'Hide' : 'View'} amortization
                  </button>
                </td>
              </tr>
            ))}
            {loans.length === 0 && (
              <tr><td colSpan={5} style={{ ...table.cell, textAlign: 'center', color: colors.textSubtle, padding: spacing.xxl }}>No loans yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: spacing.sm, marginBottom: spacing.lg, flexWrap: 'wrap', marginTop: spacing.lg }}>
        <input placeholder="Lender name" value={form.lender_name} onChange={(e) => setForm({ ...form, lender_name: e.target.value })} style={{ ...input.base, flex: 1, minWidth: 140 }} />
        <input type="number" placeholder="Principal" value={form.original_principal} onChange={(e) => setForm({ ...form, original_principal: e.target.value })} style={{ ...input.base, width: 130 }} />
        <input type="number" placeholder="Annual rate %" value={form.annual_interest_rate} onChange={(e) => setForm({ ...form, annual_interest_rate: e.target.value })} style={{ ...input.base, width: 130 }} />
        <input type="date" value={form.origination_date} onChange={(e) => setForm({ ...form, origination_date: e.target.value })} style={input.base} />
        <input type="number" placeholder="Term (months)" value={form.term_months} onChange={(e) => setForm({ ...form, term_months: e.target.value })} style={{ ...input.base, width: 130 }} />
        <button onClick={addLoan} style={button.primary}>+ Add loan</button>
      </div>

      {schedule && (
        <div style={{ maxHeight: 400, overflowY: 'auto', border: `1px solid ${colors.border}`, borderRadius: 8 }}>
          <table style={table.container}>
            <thead style={{ position: 'sticky', top: 0, background: colors.navy, zIndex: 1 }}>
              <tr>
                <th style={{ ...table.headerCell, color: colors.white, borderBottom: 'none' }}>#</th>
                <th style={{ ...table.headerCell, color: colors.white, borderBottom: 'none' }}>Date</th>
                <th style={{ ...table.headerCell, color: colors.white, borderBottom: 'none' }}>Payment</th>
                <th style={{ ...table.headerCell, color: colors.white, borderBottom: 'none' }}>Principal</th>
                <th style={{ ...table.headerCell, color: colors.white, borderBottom: 'none' }}>Interest</th>
                <th style={{ ...table.headerCell, color: colors.white, borderBottom: 'none' }}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {(schedule.schedule || []).map((row) => (
                <tr key={row.payment_number} className="hoverable-row" style={table.row}>
                  <td style={table.cell}>{row.payment_number}</td>
                  <td style={table.cell}>{row.date?.slice(0, 10)}</td>
                  <td style={{ ...table.cell, fontFamily: fonts.mono }}>{Number(row.payment_amount).toFixed(2)}</td>
                  <td style={{ ...table.cell, fontFamily: fonts.mono }}>{Number(row.principal).toFixed(2)}</td>
                  <td style={{ ...table.cell, fontFamily: fonts.mono }}>{Number(row.interest).toFixed(2)}</td>
                  <td style={{ ...table.cell, fontFamily: fonts.mono, fontWeight: fonts.weightSemibold }}>{Number(row.remaining_balance).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const styles = {
  title: { fontSize: fonts.sizeLg, fontWeight: fonts.weightSemibold, color: colors.navy, margin: `0 0 ${spacing.lg}px` },
};
