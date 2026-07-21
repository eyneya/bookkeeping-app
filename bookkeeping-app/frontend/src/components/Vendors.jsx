import { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { colors, fonts, spacing, button, input, select, table, alert } from '../theme';

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
      <h3 style={styles.title}>Vendors & 1099 Tracking</h3>

      <div style={{ overflowX: 'auto' }}>
        <table style={table.container}>
          <thead>
            <tr>
              <th style={table.headerCell}>Name</th>
              <th style={table.headerCell}>Tax ID type</th>
              <th style={table.headerCell}>Requires 1099</th>
              <th style={table.headerCell}>W-9 on file</th>
            </tr>
          </thead>
          <tbody>
            {vendors.map((v) => (
              <tr key={v.id} className="hoverable-row" style={table.row}>
                <td style={{ ...table.cell, fontWeight: fonts.weightMedium }}>{v.name}</td>
                <td style={table.cell}>{v.tax_id_type || '—'}</td>
                <td style={table.cell}>{v.requires_1099 ? 'Yes' : 'No'}</td>
                <td style={table.cell}>
                  <button onClick={() => toggleW9(v.id, v.w9_on_file)} style={v.w9_on_file ? button.smallAccent : button.small}>
                    {v.w9_on_file ? '&#10003; On file' : 'Mark received'}
                  </button>
                </td>
              </tr>
            ))}
            {vendors.length === 0 && (
              <tr><td colSpan={4} style={{ ...table.cell, textAlign: 'center', color: colors.textSubtle, padding: spacing.xxl }}>No vendors yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: spacing.sm, marginBottom: spacing.sm, flexWrap: 'wrap', marginTop: spacing.lg }}>
        <input placeholder="Vendor name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ ...input.base, flex: 1, minWidth: 160 }} />
        <select value={form.tax_id_type} onChange={(e) => setForm({ ...form, tax_id_type: e.target.value })} style={{ ...select, minWidth: 100 }}>
          <option value="ein">EIN</option>
          <option value="ssn">SSN</option>
        </select>
        <input placeholder="Tax ID (optional)" value={form.tax_id} onChange={(e) => setForm({ ...form, tax_id: e.target.value })} style={{ ...input.base, minWidth: 160 }} />
        <label style={{ fontSize: fonts.sizeSm, color: colors.text, display: 'flex', alignItems: 'center', gap: spacing.xs }}>
          <input type="checkbox" checked={form.requires_1099} onChange={(e) => setForm({ ...form, requires_1099: e.target.checked })} style={{ accentColor: colors.teal }} />
          Requires 1099
        </label>
        <button onClick={addVendor} style={button.primary}>+ Add vendor</button>
      </div>
      <p style={styles.note}>Assign a vendor to a transaction from the Review tab to track payments toward the $600 1099 threshold.</p>

      <div style={{ ...styles.divider }} />

      <h4 style={styles.sectionTitle}>1099 Summary</h4>
      <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center', marginBottom: spacing.md }}>
        <input type="number" value={year} onChange={(e) => setYear(e.target.value)} style={{ ...input.base, width: 100 }} />
        <button onClick={runSummary} style={button.accent}>Run 1099 summary</button>
      </div>
      {summary && (
        <div style={{ overflowX: 'auto' }}>
          <table style={table.container}>
            <thead>
              <tr>
                <th style={table.headerCell}>Vendor</th>
                <th style={table.headerCell}>Total Paid</th>
                <th style={table.headerCell}>Needs 1099</th>
                <th style={table.headerCell}>W-9 on File</th>
              </tr>
            </thead>
            <tbody>
              {summary.vendors.map((v) => (
                <tr key={v.vendor_id} className="hoverable-row" style={{ ...table.row, color: v.needs_1099 && !v.w9_on_file ? colors.error : colors.text }}>
                  <td style={table.cell}>{v.name}</td>
                  <td style={{ ...table.cell, fontFamily: fonts.mono }}>{v.total_paid.toFixed(2)}</td>
                  <td style={table.cell}>{v.needs_1099 ? 'Yes' : 'No'}</td>
                  <td style={table.cell}>{v.w9_on_file ? 'Yes' : 'No'}</td>
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
  note: { fontSize: fonts.sizeXs, color: colors.textSubtle, margin: `${spacing.sm}px 0 ${spacing.xl}px` },
  divider: { borderTop: `1px solid ${colors.border}`, margin: `${spacing.xl}px 0` },
  sectionTitle: { fontSize: fonts.sizeMd, fontWeight: fonts.weightSemibold, color: colors.navy, margin: `0 0 ${spacing.md}px` },
};
