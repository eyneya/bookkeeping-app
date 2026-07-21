import { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { colors, fonts, spacing, radius, button, input, select } from '../theme';

export default function CustomerPicker({ onSelect, selectedCustomerId }) {
  const [customers, setCustomers] = useState([]);
  const [newName, setNewName] = useState('');
  const [showForm, setShowForm] = useState(false);

  const loadCustomers = () => {
    apiFetch('/api/customers').then((r) => r.json()).then(setCustomers);
  };
  useEffect(loadCustomers, []);

  const createCustomer = async () => {
    if (!newName.trim()) return;
    const res = await apiFetch('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    });
    const customer = await res.json();
    setNewName('');
    setShowForm(false);
    loadCustomers();
    onSelect(customer.id);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: fonts.sizeSm, fontWeight: fonts.weightMedium, color: colors.gray700 }}>Client (person):</label>
        <select
          value={selectedCustomerId || ''}
          onChange={(e) => onSelect(e.target.value)}
          style={{ ...select, minWidth: 200, flex: 1, maxWidth: 320 }}
        >
          <option value="" disabled>Select client…</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button onClick={() => setShowForm(!showForm)} style={button.smallAccent}>+ New client</button>
      </div>

      {showForm && (
        <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center', marginTop: spacing.md }} className="slide-down">
          <input
            placeholder="Client name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{ ...input.base, flex: 1, maxWidth: 300 }}
            autoFocus
          />
          <button onClick={createCustomer} style={button.primary}>Add client</button>
          <button onClick={() => { setShowForm(false); setNewName(''); }} style={button.secondary}>Cancel</button>
        </div>
      )}
    </div>
  );
}
