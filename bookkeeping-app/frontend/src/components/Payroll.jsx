import { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { colors, fonts, spacing, button, input, select, table, alert } from '../theme';

export default function Payroll({ clientId }) {
  const [workers, setWorkers] = useState([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState(null);
  const [form, setForm] = useState({ name: '', worker_type: '1099_contractor', hourly_rate: '', annual_salary: '', pay_frequency: 'biweekly' });
  const [year, setYear] = useState(new Date().getFullYear());
  const [summary, setSummary] = useState(null);

  const load = () => {
    apiFetch(`/api/workers?client_id=${clientId}`).then((r) => r.json()).then(setWorkers);
  };
  useEffect(load, [clientId]);

  const addWorker = async () => {
    if (!form.name.trim()) return;
    await apiFetch('/api/workers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        name: form.name,
        worker_type: form.worker_type,
        hourly_rate: form.worker_type === 'w2_hourly' ? Number(form.hourly_rate || 0) : undefined,
        annual_salary: form.worker_type === 'w2_salary' ? Number(form.annual_salary || 0) : undefined,
        pay_frequency: form.worker_type !== '1099_contractor' ? form.pay_frequency : undefined,
      }),
    });
    setForm({ name: '', worker_type: '1099_contractor', hourly_rate: '', annual_salary: '', pay_frequency: 'biweekly' });
    load();
  };

  const runSummary = async () => {
    const res = await apiFetch(`/api/reports/payroll-summary?client_id=${clientId}&year=${year}`);
    setSummary(await res.json());
  };

  const typeLabel = { '1099_contractor': '1099 Contractor', w2_hourly: 'W-2 Hourly', w2_salary: 'W-2 Salary' };

  return (
    <div>
      <h3 style={styles.title}>Payroll</h3>
      <div style={{ ...alert.warning, marginBottom: spacing.lg }}>
        This tracks pay runs — it does not calculate withholding, FICA, or FUTA/SUTA. Enter those figures from your payroll processor's report.
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={table.container}>
          <thead>
            <tr>
              <th style={table.headerCell}>Name</th>
              <th style={table.headerCell}>Type</th>
              <th style={table.headerCell}>Rate</th>
              <th style={table.headerCell}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {workers.map((w) => (
              <tr key={w.id} className="hoverable-row" style={{ ...table.row, background: selectedWorkerId === w.id ? colors.infoBg : colors.white }}>
                <td style={{ ...table.cell, fontWeight: fonts.weightMedium }}>{w.name}</td>
                <td style={table.cell}>{typeLabel[w.worker_type]}</td>
                <td style={table.cell}>
                  {w.worker_type === 'w2_hourly' && `$${w.hourly_rate}/hr`}
                  {w.worker_type === 'w2_salary' && `$${Number(w.annual_salary).toLocaleString()}/yr`}
                  {w.worker_type === '1099_contractor' && <span style={{ color: colors.textSubtle }}>—</span>}
                </td>
                <td style={table.cell}>
                  {w.worker_type !== '1099_contractor' ? (
                    <button onClick={() => setSelectedWorkerId(selectedWorkerId === w.id ? null : w.id)} style={button.small}>
                      {selectedWorkerId === w.id ? 'Close' : 'Pay runs'}
                    </button>
                  ) : (
                    <span style={{ fontSize: fonts.sizeXs, color: colors.textSubtle }}>Tracked via Vendors tab</span>
                  )}
                </td>
              </tr>
            ))}
            {workers.length === 0 && (
              <tr><td colSpan={4} style={{ ...table.cell, textAlign: 'center', color: colors.textSubtle, padding: spacing.xxl }}>No workers yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: spacing.sm, marginBottom: spacing.sm, flexWrap: 'wrap', alignItems: 'center', marginTop: spacing.lg }}>
        <input placeholder="Worker name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ ...input.base, flex: 1, minWidth: 140 }} />
        <select value={form.worker_type} onChange={(e) => setForm({ ...form, worker_type: e.target.value })} style={{ ...select, minWidth: 160 }}>
          <option value="1099_contractor">1099 Contractor</option>
          <option value="w2_hourly">W-2 Hourly</option>
          <option value="w2_salary">W-2 Salary</option>
        </select>
        {form.worker_type === 'w2_hourly' && (
          <input type="number" placeholder="Hourly rate" value={form.hourly_rate} onChange={(e) => setForm({ ...form, hourly_rate: e.target.value })} style={{ ...input.base, width: 120 }} />
        )}
        {form.worker_type === 'w2_salary' && (
          <input type="number" placeholder="Annual salary" value={form.annual_salary} onChange={(e) => setForm({ ...form, annual_salary: e.target.value })} style={{ ...input.base, width: 140 }} />
        )}
        {form.worker_type !== '1099_contractor' && (
          <select value={form.pay_frequency} onChange={(e) => setForm({ ...form, pay_frequency: e.target.value })} style={{ ...select, minWidth: 140 }}>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Biweekly</option>
            <option value="semimonthly">Semimonthly</option>
            <option value="monthly">Monthly</option>
          </select>
        )}
        <button onClick={addWorker} style={button.primary}>+ Add worker</button>
      </div>
      {form.worker_type === '1099_contractor' && (
        <p style={styles.note}>This automatically creates a vendor record so their payments feed the 1099 Summary report — track their payments via the Vendors tab, not pay runs.</p>
      )}

      {selectedWorkerId && <PayRuns workerId={selectedWorkerId} />}

      <div style={styles.divider} />

      <h4 style={styles.sectionTitle}>Payroll Summary</h4>
      <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center', marginBottom: spacing.md }}>
        <input type="number" value={year} onChange={(e) => setYear(e.target.value)} style={{ ...input.base, width: 100 }} />
        <button onClick={runSummary} style={button.accent}>Run payroll summary</button>
      </div>
      {summary && (
        <div style={{ overflowX: 'auto' }}>
          <table style={table.container}>
            <thead>
              <tr>
                <th style={table.headerCell}>Worker</th>
                <th style={table.headerCell}>Type</th>
                <th style={table.headerCell}>Gross Pay</th>
                <th style={table.headerCell}>Employer Tax Cost</th>
                <th style={table.headerCell}>Net Pay</th>
              </tr>
            </thead>
            <tbody>
              {summary.workers.map((w) => (
                <tr key={w.worker_id} className="hoverable-row" style={table.row}>
                  <td style={table.cell}>{w.name}</td>
                  <td style={table.cell}>{typeLabel[w.worker_type]}</td>
                  <td style={{ ...table.cell, fontFamily: fonts.mono }}>{w.gross_pay.toFixed(2)}</td>
                  <td style={{ ...table.cell, fontFamily: fonts.mono }}>{w.employer_tax_cost.toFixed(2)}</td>
                  <td style={{ ...table.cell, fontFamily: fonts.mono, fontWeight: fonts.weightSemibold }}>{w.net_pay.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: fonts.sizeXs, color: colors.textSubtle, marginTop: spacing.sm }}>{summary.caveat}</p>
        </div>
      )}
    </div>
  );
}

function PayRuns({ workerId }) {
  const [runs, setRuns] = useState([]);
  const [form, setForm] = useState({
    pay_period_start: '', pay_period_end: '', pay_date: '', hours_worked: '', gross_pay: '',
    federal_withholding: '0', state_withholding: '0', social_security_employee: '0', medicare_employee: '0',
    employer_social_security: '0', employer_medicare: '0', employer_futa: '0', employer_suta: '0',
  });

  const load = () => {
    apiFetch(`/api/payroll-payments?worker_id=${workerId}`).then((r) => r.json()).then(setRuns);
  };
  useEffect(load, [workerId]);

  const addRun = async () => {
    if (!form.pay_period_start || !form.pay_period_end || !form.pay_date || !form.gross_pay) return;
    await apiFetch('/api/payroll-payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        worker_id: workerId,
        ...form,
        hours_worked: form.hours_worked ? Number(form.hours_worked) : undefined,
        gross_pay: Number(form.gross_pay),
        federal_withholding: Number(form.federal_withholding || 0),
        state_withholding: Number(form.state_withholding || 0),
        social_security_employee: Number(form.social_security_employee || 0),
        medicare_employee: Number(form.medicare_employee || 0),
        employer_social_security: Number(form.employer_social_security || 0),
        employer_medicare: Number(form.employer_medicare || 0),
        employer_futa: Number(form.employer_futa || 0),
        employer_suta: Number(form.employer_suta || 0),
      }),
    });
    load();
  };

  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, padding: spacing.xl, marginBottom: spacing.lg, marginTop: spacing.lg, background: colors.gray50 }}>
      <h4 style={styles.sectionTitle}>Pay runs</h4>
      <div style={{ overflowX: 'auto' }}>
        <table style={table.container}>
          <thead>
            <tr>
              <th style={table.headerCell}>Pay Date</th>
              <th style={table.headerCell}>Gross</th>
              <th style={table.headerCell}>Withholding</th>
              <th style={table.headerCell}>Net</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="hoverable-row" style={table.row}>
                <td style={table.cell}>{r.pay_date?.slice(0, 10)}</td>
                <td style={{ ...table.cell, fontFamily: fonts.mono }}>{Number(r.gross_pay).toFixed(2)}</td>
                <td style={{ ...table.cell, fontFamily: fonts.mono }}>{(Number(r.federal_withholding) + Number(r.state_withholding) + Number(r.social_security_employee) + Number(r.medicare_employee)).toFixed(2)}</td>
                <td style={{ ...table.cell, fontFamily: fonts.mono, fontWeight: fonts.weightSemibold }}>{Number(r.net_pay).toFixed(2)}</td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr><td colSpan={4} style={{ ...table.cell, textAlign: 'center', color: colors.textSubtle, padding: spacing.lg }}>No pay runs yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: spacing.sm, marginTop: spacing.lg, fontSize: fonts.sizeXs }}>
        {[
          ['Period start', 'pay_period_start', 'date'], ['Period end', 'pay_period_end', 'date'], ['Pay date', 'pay_date', 'date'],
          ['Hours (if hourly)', 'hours_worked', 'number'], ['Gross pay', 'gross_pay', 'number'], ['Federal w/h', 'federal_withholding', 'number'],
          ['State w/h', 'state_withholding', 'number'], ['SS (employee)', 'social_security_employee', 'number'], ['Medicare (employee)', 'medicare_employee', 'number'],
          ['SS (employer)', 'employer_social_security', 'number'], ['Medicare (employer)', 'employer_medicare', 'number'],
          ['FUTA', 'employer_futa', 'number'], ['SUTA', 'employer_suta', 'number'],
        ].map(([label, key, type]) => (
          <label key={key} style={{ fontSize: fonts.sizeXs, fontWeight: fonts.weightMedium, color: colors.gray700 }}>
            {label}
            <input type={type} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} style={{ ...input.small, width: '100%', marginTop: 2 }} />
          </label>
        ))}
      </div>
      <button onClick={addRun} style={{ ...button.primary, marginTop: spacing.md }}>+ Add pay run</button>
    </div>
  );
}

const styles = {
  title: { fontSize: fonts.sizeLg, fontWeight: fonts.weightSemibold, color: colors.navy, margin: `0 0 ${spacing.lg}px` },
  sectionTitle: { fontSize: fonts.sizeMd, fontWeight: fonts.weightSemibold, color: colors.navy, margin: `0 0 ${spacing.md}px` },
  note: { fontSize: fonts.sizeXs, color: colors.textSubtle, marginBottom: spacing.lg },
  divider: { borderTop: `1px solid ${colors.border}`, margin: `${spacing.xl}px 0` },
};
