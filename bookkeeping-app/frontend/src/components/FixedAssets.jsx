import { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import Modal from './Modal';

export default function FixedAssets({ clientId }) {
  const [assets, setAssets] = useState([]);
  const [schedule, setSchedule] = useState(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [disposeAssetId, setDisposeAssetId] = useState(null);
  const [form, setForm] = useState({
    description: '', purchase_date: '', purchase_amount: '', section_179_amount: '0',
    bonus_depreciation_amount: '0', useful_life_years: '5',
  });

  const load = () => {
    apiFetch(`/api/fixed-assets?client_id=${clientId}`).then((r) => r.json()).then(setAssets);
  };
  useEffect(load, [clientId]);

  const addAsset = async () => {
    if (!form.description.trim() || !form.purchase_date || !form.purchase_amount) return;
    await apiFetch('/api/fixed-assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        description: form.description,
        purchase_date: form.purchase_date,
        purchase_amount: Number(form.purchase_amount),
        section_179_amount: Number(form.section_179_amount || 0),
        bonus_depreciation_amount: Number(form.bonus_depreciation_amount || 0),
        useful_life_years: Number(form.useful_life_years),
      }),
    });
    setForm({ description: '', purchase_date: '', purchase_amount: '', section_179_amount: '0', bonus_depreciation_amount: '0', useful_life_years: '5' });
    load();
  };

  const disposeAsset = async (date, amount) => {
    await apiFetch(`/api/fixed-assets/${disposeAssetId}/dispose`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disposed_date: date, disposed_amount: Number(amount || 0) }),
    });
    setDisposeAssetId(null);
    load();
  };

  const runSchedule = async () => {
    const res = await apiFetch(`/api/reports/depreciation-schedule?client_id=${clientId}&year=${year}`);
    setSchedule(await res.json());
  };

  return (
    <div>
      <h3>Fixed Assets</h3>
      <p style={{ fontSize: 12, color: '#b45309' }}>
        Straight-line depreciation only — verify final figures against IRS Pub. 946 (MACRS tables) or your tax software before filing.
      </p>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginBottom: 16 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
            <th style={cell}>Description</th>
            <th style={cell}>Purchase Date</th>
            <th style={cell}>Amount</th>
            <th style={cell}>Useful Life</th>
            <th style={cell}>Status</th>
          </tr>
        </thead>
        <tbody>
          {assets.map((a) => (
            <tr key={a.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={cell}>{a.description}</td>
              <td style={cell}>{a.purchase_date?.slice(0, 10)}</td>
              <td style={cell}>{Number(a.purchase_amount).toFixed(2)}</td>
              <td style={cell}>{a.useful_life_years} yrs</td>
              <td style={cell}>
                {a.disposed_date ? `Disposed ${a.disposed_date.slice(0, 10)}` : (
                  <button onClick={() => setDisposeAssetId(a.id)} style={btn}>Record disposal</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={input} />
        <input type="date" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} style={input} />
        <input type="number" placeholder="Purchase amount" value={form.purchase_amount} onChange={(e) => setForm({ ...form, purchase_amount: e.target.value })} style={input} />
        <input type="number" placeholder="Sec. 179 amount" value={form.section_179_amount} onChange={(e) => setForm({ ...form, section_179_amount: e.target.value })} style={{ ...input, width: 130 }} />
        <input type="number" placeholder="Bonus depr." value={form.bonus_depreciation_amount} onChange={(e) => setForm({ ...form, bonus_depreciation_amount: e.target.value })} style={{ ...input, width: 130 }} />
        <input type="number" placeholder="Useful life (yrs)" value={form.useful_life_years} onChange={(e) => setForm({ ...form, useful_life_years: e.target.value })} style={{ ...input, width: 140 }} />
        <button onClick={addAsset} style={{ padding: '8px 12px', cursor: 'pointer' }}>+ Add asset</button>
      </div>

      <hr style={{ margin: '20px 0' }} />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <input type="number" value={year} onChange={(e) => setYear(e.target.value)} style={{ ...input, width: 100 }} />
        <button onClick={runSchedule} style={{ padding: '8px 12px', cursor: 'pointer' }}>Run depreciation schedule</button>
      </div>
      {schedule && (
        <div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr><th>Asset</th><th>{schedule.year} Depreciation</th><th>Accumulated</th><th>Book Value</th></tr>
            </thead>
            <tbody>
              {schedule.assets.map((a) => (
                <tr key={a.asset_id}>
                  <td>{a.description}</td>
                  <td>{a.annualDepreciation.toFixed(2)}</td>
                  <td>{a.accumulatedDepreciation.toFixed(2)}</td>
                  <td>{a.bookValue.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 12, color: '#888', marginTop: 8 }}>{schedule.caveat}</p>
        </div>
      )}

      {disposeAssetId && (
        <DisposeAssetModal
          onClose={() => setDisposeAssetId(null)}
          onSubmit={disposeAsset}
        />
      )}
    </div>
  );
}

function DisposeAssetModal({ onClose, onSubmit }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('0');

  return (
    <Modal title="Record asset disposal" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ fontSize: 13 }}>
          Disposal date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...input, width: '100%', marginTop: 4 }} />
        </label>
        <label style={{ fontSize: 13 }}>
          Sale/disposal proceeds (0 if scrapped)
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ ...input, width: '100%', marginTop: 4 }} />
        </label>
        <button onClick={() => onSubmit(date, amount)} style={{ padding: '8px 12px', cursor: 'pointer', marginTop: 8 }}>
          Save
        </button>
      </div>
    </Modal>
  );
}

const cell = { padding: '8px 6px' };
const input = { padding: 8, fontSize: 14 };
const btn = { padding: '4px 8px', fontSize: 12, cursor: 'pointer' };
