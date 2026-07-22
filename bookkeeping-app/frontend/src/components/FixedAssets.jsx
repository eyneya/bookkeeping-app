import { useEffect, useState } from 'react';
import { listFixedAssets, createFixedAsset, updateFixedAsset, runReport } from '../api';
import Modal from './Modal';
import { colors, fonts, spacing, button, input, table, alert } from '../theme';

export default function FixedAssets({ clientId }) {
  const [assets, setAssets] = useState([]);
  const [schedule, setSchedule] = useState(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [disposeAssetId, setDisposeAssetId] = useState(null);
  const [form, setForm] = useState({
    description: '', purchase_date: '', purchase_amount: '', section_179_amount: '0',
    bonus_depreciation_amount: '0', useful_life_years: '5',
  });

  const load = () => { listFixedAssets(clientId).then(setAssets); };
  useEffect(load, [clientId]);

  const addAsset = async () => {
    if (!form.description.trim() || !form.purchase_date || !form.purchase_amount) return;
    await createFixedAsset({
      client_id: clientId,
      description: form.description,
      purchase_date: form.purchase_date,
      purchase_amount: Number(form.purchase_amount),
      section_179_amount: Number(form.section_179_amount || 0),
      bonus_depreciation_amount: Number(form.bonus_depreciation_amount || 0),
      useful_life_years: Number(form.useful_life_years),
    });
    setForm({ description: '', purchase_date: '', purchase_amount: '', section_179_amount: '0', bonus_depreciation_amount: '0', useful_life_years: '5' });
    load();
  };

  const disposeAsset = async (date, amount) => {
    await updateFixedAsset(disposeAssetId, { disposed_date: date, disposed_amount: Number(amount || 0) });
    setDisposeAssetId(null);
    load();
  };

  const runSchedule = async () => {
    const data = await runReport('depreciation-schedule', { client_id: clientId, year });
    setSchedule(data);
  };

  return (
    <div>
      <h3 style={styles.title}>Fixed Assets</h3>
      <div style={{ ...alert.warning, marginBottom: spacing.lg }}>
        Straight-line depreciation only — verify final figures against IRS Pub. 946 (MACRS tables) or your tax software before filing.
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={table.container}>
          <thead>
            <tr>
              <th style={table.headerCell}>Description</th>
              <th style={table.headerCell}>Purchase Date</th>
              <th style={table.headerCell}>Amount</th>
              <th style={table.headerCell}>Useful Life</th>
              <th style={table.headerCell}>Status</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.id} className="hoverable-row" style={table.row}>
                <td style={{ ...table.cell, fontWeight: fonts.weightMedium }}>{a.description}</td>
                <td style={table.cell}>{a.purchase_date?.slice(0, 10)}</td>
                <td style={{ ...table.cell, fontFamily: fonts.mono }}>{Number(a.purchase_amount).toFixed(2)}</td>
                <td style={table.cell}>{a.useful_life_years} yrs</td>
                <td style={table.cell}>
                  {a.disposed_date ? <span style={{ color: colors.textMuted }}>Disposed {a.disposed_date.slice(0, 10)}</span> : (
                    <button onClick={() => setDisposeAssetId(a.id)} style={button.small}>Record disposal</button>
                  )}
                </td>
              </tr>
            ))}
            {assets.length === 0 && (
              <tr><td colSpan={5} style={{ ...table.cell, textAlign: 'center', color: colors.textSubtle, padding: spacing.xxl }}>No assets yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: spacing.sm, marginBottom: spacing.lg, flexWrap: 'wrap', marginTop: spacing.lg }}>
        <input placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ ...input.base, flex: 1, minWidth: 140 }} />
        <input type="date" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} style={input.base} />
        <input type="number" placeholder="Purchase amount" value={form.purchase_amount} onChange={(e) => setForm({ ...form, purchase_amount: e.target.value })} style={{ ...input.base, width: 140 }} />
        <input type="number" placeholder="Sec. 179" value={form.section_179_amount} onChange={(e) => setForm({ ...form, section_179_amount: e.target.value })} style={{ ...input.base, width: 110 }} />
        <input type="number" placeholder="Bonus depr." value={form.bonus_depreciation_amount} onChange={(e) => setForm({ ...form, bonus_depreciation_amount: e.target.value })} style={{ ...input.base, width: 110 }} />
        <input type="number" placeholder="Life (yrs)" value={form.useful_life_years} onChange={(e) => setForm({ ...form, useful_life_years: e.target.value })} style={{ ...input.base, width: 100 }} />
        <button onClick={addAsset} style={button.primary}>+ Add asset</button>
      </div>

      <div style={styles.divider} />

      <h4 style={styles.sectionTitle}>Depreciation Schedule</h4>
      <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center', marginBottom: spacing.md }}>
        <input type="number" value={year} onChange={(e) => setYear(e.target.value)} style={{ ...input.base, width: 100 }} />
        <button onClick={runSchedule} style={button.accent}>Run schedule</button>
      </div>
      {schedule && (
        <div style={{ overflowX: 'auto' }}>
          <table style={table.container}>
            <thead>
              <tr>
                <th style={table.headerCell}>Asset</th>
                <th style={table.headerCell}>{schedule.year} Depreciation</th>
                <th style={table.headerCell}>Accumulated</th>
                <th style={table.headerCell}>Book Value</th>
              </tr>
            </thead>
            <tbody>
              {(schedule.assets || []).map((a) => (
                <tr key={a.asset_id} className="hoverable-row" style={table.row}>
                  <td style={table.cell}>{a.description}</td>
                  <td style={{ ...table.cell, fontFamily: fonts.mono }}>{Number(a.annualDepreciation).toFixed(2)}</td>
                  <td style={{ ...table.cell, fontFamily: fonts.mono }}>{Number(a.accumulatedDepreciation).toFixed(2)}</td>
                  <td style={{ ...table.cell, fontFamily: fonts.mono, fontWeight: fonts.weightSemibold }}>{Number(a.bookValue).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: fonts.sizeXs, color: colors.textSubtle, marginTop: spacing.sm }}>{schedule.caveat}</p>
        </div>
      )}

      {disposeAssetId && <DisposeAssetModal onClose={() => setDisposeAssetId(null)} onSubmit={disposeAsset} />}
    </div>
  );
}

function DisposeAssetModal({ onClose, onSubmit }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('0');

  return (
    <Modal title="Record asset disposal" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
        <label style={styles.fieldLabel}>
          Disposal date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...input.base, width: '100%', marginTop: spacing.xs }} />
        </label>
        <label style={styles.fieldLabel}>
          Sale/disposal proceeds (0 if scrapped)
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ ...input.base, width: '100%', marginTop: spacing.xs }} />
        </label>
        <button onClick={() => onSubmit(date, amount)} style={{ ...button.primary, marginTop: spacing.sm }}>Save</button>
      </div>
    </Modal>
  );
}

const styles = {
  title: { fontSize: fonts.sizeLg, fontWeight: fonts.weightSemibold, color: colors.navy, margin: `0 0 ${spacing.lg}px` },
  sectionTitle: { fontSize: fonts.sizeMd, fontWeight: fonts.weightSemibold, color: colors.navy, margin: `0 0 ${spacing.md}px` },
  divider: { borderTop: `1px solid ${colors.border}`, margin: `${spacing.xl}px 0` },
  fieldLabel: { fontSize: fonts.sizeSm, fontWeight: fonts.weightMedium, color: colors.gray700, display: 'flex', flexDirection: 'column' },
};
