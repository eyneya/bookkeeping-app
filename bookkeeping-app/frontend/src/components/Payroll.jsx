import { useEffect, useState } from 'react';
import { apiFetch } from '../api';

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
      <h3>Payroll</h3>
      <p style={{ fontSize: 12, color: '#b45309' }}>
        This tracks pay runs — it does not calculate withholding, FICA, or FUTA/SUTA. Enter those figures from your payroll processor's report.
      </p>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginBottom: 16 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
            <th style={cell}>Name</th>
            <th style={cell}>Type</th>
            <th style={cell}>Rate</th>
            <th style={cell}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {workers.map((w) => (
            <tr key={w.id} style={{ borderBottom: '1px solid #f0f0f0', background: selectedWorkerId === w.id ? '#eff6ff' : 'white' }}>
              <td style={cell}>{w.name}</td>
              <td style={cell}>{typeLabel[w.worker_type]}</td>
              <td style={cell}>
                {w.worker_type === 'w2_hourly' && `$${w.hourly_rate}/hr`}
                {w.worker_type === 'w2_salary' && `$${Number(w.annual_salary).toLocaleString()}/yr`}
                {w.worker_type === '1099_contractor' && '—'}
              </td>
              <td style={cell}>
                {w.worker_type !== '1099_contractor' ? (
                  <button onClick={() => setSelectedWorkerId(selectedWorkerId === w.id ? null : w.id)} style={btn}>
                    {selectedWorkerId === w.id ? 'Close' : 'Pay runs'}
                  </button>
                ) : (
                  <span style={{ fontSize: 12, color: '#888' }}>Tracked via Vendors tab</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="Worker name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={input} />
        <select value={form.worker_type} onChange={(e) => setForm({ ...form, worker_type: e.target.value })} style={input}>
          <option value="1099_contractor">1099 Contractor</option>
          <option value="w2_hourly">W-2 Hourly</option>
          <option value="w2_salary">W-2 Salary</option>
        </select>
        {form.worker_type === 'w2_hourly' && (
          <input type="number" placeholder="Hourly rate" value={form.hourly_rate} onChange={(e) => setForm({ ...form, hourly_rate: e.target.value })} style={{ ...input, width: 120 }} />
        )}
        {form.worker_type === 'w2_salary' && (
          <input type="number" placeholder="Annual salary" value={form.annual_salary} onChange={(e) => setForm({ ...form, annual_salary: e.target.value })} style={{ ...input, width: 140 }} />
        )}
        {form.worker_type !== '1099_contractor' && (
          <select value={form.pay_frequency} onChange={(e) => setForm({ ...form, pay_frequency: e.target.value })} style={input}>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Biweekly</option>
            <option value="semimonthly">Semimonthly</option>
            <option value="monthly">Monthly</option>
          </select>
        )}
        <button onClick={addWorker} style={{ padding: '8px 12px', cursor: 'pointer' }}>+ Add worker</button>
      </div>
      {form.worker_type === '1099_contractor' && (
        <p style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>
          This automatically creates a vendor record so their payments feed the 1099 Summary report — track their payments via the Vendors tab, not pay runs.
        </p>
      )}

      {selectedWorkerId && <PayRuns workerId={selectedWorkerId} />}

      <hr style={{ margin: '20px 0' }} />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <input type="number" value={year} onChange={(e) => setYear(e.target.value)} style={{ ...input, width: 100 }} />
        <button onClick={runSummary} style={{ padding: '8px 12px', cursor: 'pointer' }}>Run payroll summary</button>
      </div>
      {summary && (
        <div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr><th>Worker</th><th>Type</th><th>Gross Pay</th><th>Employer Tax Cost</th><th>Net Pay</th></tr>
            </thead>
            <tbody>
              {summary.workers.map((w) => (
                <tr key={w.worker_id}>
                  <td>{w.name}</td>
                  <td>{typeLabel[w.worker_type]}</td>
                  <td>{w.gross_pay.toFixed(2)}</td>
                  <td>{w.employer_tax_cost.toFixed(2)}</td>
                  <td>{w.net_pay.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 12, color: '#888', marginTop: 8 }}>{summary.caveat}</p>
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
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <h4>Pay runs</h4>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 12 }}>
        <thead>
          <tr><th>Pay Date</th><th>Gross</th><th>Withholding</th><th>Net</th></tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td>{r.pay_date?.slice(0, 10)}</td>
              <td>{Number(r.gross_pay).toFixed(2)}</td>
              <td>{(Number(r.federal_withholding) + Number(r.state_withholding) + Number(r.social_security_employee) + Number(r.medicare_employee)).toFixed(2)}</td>
              <td>{Number(r.net_pay).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, fontSize: 12 }}>
        <label>Period start<input type="date" value={form.pay_period_start} onChange={(e) => setForm({ ...form, pay_period_start: e.target.value })} style={input} /></label>
        <label>Period end<input type="date" value={form.pay_period_end} onChange={(e) => setForm({ ...form, pay_period_end: e.target.value })} style={input} /></label>
        <label>Pay date<input type="date" value={form.pay_date} onChange={(e) => setForm({ ...form, pay_date: e.target.value })} style={input} /></label>
        <label>Hours (if hourly)<input type="number" value={form.hours_worked} onChange={(e) => setForm({ ...form, hours_worked: e.target.value })} style={input} /></label>
        <label>Gross pay<input type="number" value={form.gross_pay} onChange={(e) => setForm({ ...form, gross_pay: e.target.value })} style={input} /></label>
        <label>Federal w/h<input type="number" value={form.federal_withholding} onChange={(e) => setForm({ ...form, federal_withholding: e.target.value })} style={input} /></label>
        <label>State w/h<input type="number" value={form.state_withholding} onChange={(e) => setForm({ ...form, state_withholding: e.target.value })} style={input} /></label>
        <label>SS (employee)<input type="number" value={form.social_security_employee} onChange={(e) => setForm({ ...form, social_security_employee: e.target.value })} style={input} /></label>
        <label>Medicare (employee)<input type="number" value={form.medicare_employee} onChange={(e) => setForm({ ...form, medicare_employee: e.target.value })} style={input} /></label>
        <label>SS (employer)<input type="number" value={form.employer_social_security} onChange={(e) => setForm({ ...form, employer_social_security: e.target.value })} style={input} /></label>
        <label>Medicare (employer)<input type="number" value={form.employer_medicare} onChange={(e) => setForm({ ...form, employer_medicare: e.target.value })} style={input} /></label>
        <label>FUTA<input type="number" value={form.employer_futa} onChange={(e) => setForm({ ...form, employer_futa: e.target.value })} style={input} /></label>
        <label>SUTA<input type="number" value={form.employer_suta} onChange={(e) => setForm({ ...form, employer_suta: e.target.value })} style={input} /></label>
      </div>
      <button onClick={addRun} style={{ padding: '8px 12px', cursor: 'pointer', marginTop: 8 }}>+ Add pay run</button>
    </div>
  );
}

const cell = { padding: '8px 6px' };
const input = { padding: 6, fontSize: 13, width: '100%', boxSizing: 'border-box' };
const btn = { padding: '4px 8px', fontSize: 12, cursor: 'pointer' };
