import { useEffect, useState } from 'react';
import { apiFetch } from '../api';

export default function CustomerPicker({ onSelect, selectedCustomerId }) {
  const [customers, setCustomers] = useState([]);
  const [newName, setNewName] = useState('');

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
    loadCustomers();
    onSelect(customer.id);
  };

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <label style={{ fontSize: 13, color: '#666' }}>Client (person):</label>
      <select
        value={selectedCustomerId || ''}
        onChange={(e) => onSelect(e.target.value)}
        style={{ padding: 8, fontSize: 14 }}
      >
        <option value="" disabled>Select client…</option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <input
        placeholder="New client name"
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        style={{ padding: 8, fontSize: 14 }}
      />
      <button onClick={createCustomer} style={{ padding: '8px 12px', cursor: 'pointer' }}>+ Add client</button>
    </div>
  );
}
