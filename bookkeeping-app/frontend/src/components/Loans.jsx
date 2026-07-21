import { useEffect, useState } from 'react';
import { apiFetch } from '../api';

export default function Loans({ clientId }) {
  const [loans, setLoans] = useState([]);
  const [selectedLoanId, setSelectedLoanId] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [form, setForm] = useState({ lender_name: '', original_principal: '', annual_interest_rate: '', origination_date: '', term_months: '60' });

  const load = () => {
    apiFetch(`/api/loans?client_id=${clientId}`).then((r) => r.json()).then(setLoans);
  };
  useEffect(load, [clientId]);

  const addLoan = async () => {
    if (!form.lender_name.trim() || !form.original_principal || !form.origination_date) return;
    await apiFetch('/api/loans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        lender_name: form.lender_name,
        original_principal: Number(form.original_principal),
        annual_interest_rate: Number(form.annual_interest_rate),
        origination_date: form.origination_date,
        term_months: Number(form.term_months),
      }),
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
    const res = await apiFetch(`/api/reports/loan-amortization?loan_id=${loanId}`);
    setSchedule(await res.json());
  };

  return (
    <div>
      <h3>Loans</h3>
      <p style={{ fontSize: 12, color: '#888' }}>
        Standard fixed-rate amortization. Doesn't handle variable rates, balloon payments, or interest-only periods.
      </p>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginBottom: 16 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
            <th style={cell}>Lender</th>
            <th style={cell}>Principal</th>
            <th style={cell}>Rate</th>
            <th style={cell}>Term</th>
            <th style={cell}>Schedule</th>
          </tr>
        </thead>
        <tbody>
          {loans.map((l) => (
            <tr key={l.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={cell}>{l.lender_name}</td>
              <td style={cell}>{Number(l.original_principal).toFixed(2)}</td>
              <td style={cell}>{l.annual_interest_rate}%</td>
              <td style={cell}>{l.term_months} mo</td>
              <td style={cell}>
                <button onClick={() => viewSchedule(l.id)} style={btn}>
                  {selectedLoanId === l.id ? 'Hide' : 'View'} amortization
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input placeholder="Lender name" value={form.lender_name} onChange={(e) => setForm({ ...form, lender_name: e.target.value })} style={input} />
        <input type="number" placeholder="Principal" value={form.original_principal} onChange={(e) => setForm({ ...form, original_principal: e.target.value })} style={input} />
        <input type="number" placeholder="Annual rate %" value={form.annual_interest_rate} onChange={(e) => setForm({ ...form, annual_interest_rate: e.target.value })} style={{ ...input, width: 130 }} />
        <input type="date" value={form.origination_date} onChange={(e) => setForm({ ...form, origination_date: e.target.value })} style={input} />
        <input type="number" placeholder="Term (months)" value={form.term_months} onChange={(e) => setForm({ ...form, term_months: e.target.value })} style={{ ...input, width: 130 }} />
        <button onClick={addLoan} style={{ padding: '8px 12px', cursor: 'pointer' }}>+ Add loan</button>
      </div>

      {schedule && (
        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ position: 'sticky', top: 0, background: 'white' }}>
                <th>#</th><th>Date</th><th>Payment</th><th>Principal</th><th>Interest</th><th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {schedule.schedule.map((row) => (
                <tr key={row.payment_number}>
                  <td>{row.payment_number}</td>
                  <td>{row.date}</td>
                  <td>{row.payment_amount.toFixed(2)}</td>
                  <td>{row.principal.toFixed(2)}</td>
                  <td>{row.interest.toFixed(2)}</td>
                  <td>{row.remaining_balance.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const cell = { padding: '8px 6px' };
const input = { padding: 8, fontSize: 14 };
const btn = { padding: '4px 8px', fontSize: 12, cursor: 'pointer' };
