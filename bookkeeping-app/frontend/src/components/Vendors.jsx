import { useEffect, useState } from 'react';
import { apiFetch } from '../api';

export default function Vendors({ clientId }) {
  const [vendors, setVendors] = useState([]);
  const [summary, setSummary] = useState(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [form, setForm] = useState({ name: '', tax_id: '', tax_id_type: 'ein', requires_1099: true, w9_on_file: false });

  const load = () => {
    apiFetch(`/api/vendors?client_id=${clientId}`).then((r) => r.json()).then(setVendors);
  };
  useEffect(load, [clientId]);

  const addVendor = async () => {
    if (!form.name.trim()) return;
    await apiFetch('/api/vendors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, ...form }),
    });
    setForm({ name: '', tax_id: '', tax_id_type: 'ein', requires_1099: true, w9_on_file: false });
    load();
  };

  const toggleW9 = async (vendorId, current) => {
    await apiFetch(`/api/vendors/${vendorId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ w9_on_file: !current }),
    });
    load();
  };

  const runSummary = async () => {
    const res = await apiFetch(`/api/reports/1099-summary?client_id=${clientId}&year=${year}`);
    setSummary(await res.json());
  };

  return (
    <div>
      <h3>Vendors</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginBottom: 16 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
            <th style={cell}>Name</th>
            <th style={cell}>Tax ID type</th>
            <th style={cell}>Requires 1099</th>
            <th style={cell}>W-9 on file</th>
          </tr>
        </thead>
        <tbody>
          {vendors.map((v) => (
            <tr key={v.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={cell}>{v.name}</td>
              <td style={cell}>{v.tax_id_type || '—'}</td>
              <td style={cell}>{v.requires_1099 ? 'Yes' : 'No'}</td>
              <td style={cell}>
                <button onClick={() => toggleW9(v.id, v.w9_on_file)} style={btn}>
                  {v.w9_on_file ? '✓ On file' : 'Mark received'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <input placeholder="Vendor name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={input} />
        <select value={form.tax_id_type} onChange={(e) => setForm({ ...form, tax_id_type: e.target.value })} style={input}>
          <option value="ein">EIN</option>
          <option value="ssn">SSN</option>
        </select>
        <input placeholder="Tax ID (optional for now)" value={form.tax_id} onChange={(e) => setForm({ ...form, tax_id: e.target.value })} style={input} />
        <label style={{ fontSize: 13 }}>
          <input type="checkbox" checked={form.requires_1099} onChange={(e) => setForm({ ...form, requires_1099: e.target.checked })} />
          {' '}Requires 1099
        </label>
        <button onClick={addVendor} style={{ padding: '8px 12px', cursor: 'pointer' }}>+ Add vendor</button>
      </div>
      <p style={{ fontSize: 12, color: '#888' }}>
        Assign a vendor to a transaction from the Review tab to track payments toward the $600 1099 threshold.
      </p>

      <hr style={{ margin: '20px 0' }} />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <input type="number" value={year} onChange={(e) => setYear(e.target.value)} style={{ ...input, width: 100 }} />
        <button onClick={runSummary} style={{ padding: '8px 12px', cursor: 'pointer' }}>Run 1099 summary</button>
      </div>
      {summary && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr><th>Vendor</th><th>Total Paid</th><th>Needs 1099</th><th>W-9 on File</th></tr>
          </thead>
          <tbody>
            {summary.vendors.map((v) => (
              <tr key={v.vendor_id} style={{ color: v.needs_1099 && !v.w9_on_file ? '#dc2626' : 'inherit' }}>
                <td>{v.name}</td>
                <td>{v.total_paid.toFixed(2)}</td>
                <td>{v.needs_1099 ? 'Yes' : 'No'}</td>
                <td>{v.w9_on_file ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const cell = { padding: '8px 6px' };
const input = { padding: 8, fontSize: 14 };
const btn = { padding: '4px 8px', fontSize: 12, cursor: 'pointer' };
