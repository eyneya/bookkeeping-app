import { useEffect, useState } from 'react';
import { apiFetch } from '../api';

export default function ClientPicker({ customerId, onSelect, selectedClientId }) {
  const [businesses, setBusinesses] = useState([]);
  const [newName, setNewName] = useState('');
  const [entityType, setEntityType] = useState('llc_single_member');
  const [storageProvider, setStorageProvider] = useState('google');
  const [ownerType, setOwnerType] = useState('partner');
  const [ownershipPct, setOwnershipPct] = useState('100');

  const loadBusinesses = () => {
    apiFetch(`/api/customers/${customerId}`).then((r) => r.json()).then((c) => setBusinesses(c.businesses || []));
  };

  useEffect(loadBusinesses, [customerId]);

  const createBusiness = async () => {
    if (!newName.trim()) return;
    const res = await apiFetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newName,
        entity_type: entityType,
        storage_provider: storageProvider,
        customer_id: customerId,
        owner_type: ownerType,
        ownership_percentage: Number(ownershipPct),
      }),
    });
    const business = await res.json();
    setNewName('');
    loadBusinesses();
    onSelect(business.id);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <label style={{ fontSize: 13, color: '#666' }}>Business:</label>
        <select
          value={selectedClientId || ''}
          onChange={(e) => onSelect(e.target.value)}
          style={{ padding: 8, fontSize: 14 }}
        >
          <option value="" disabled>Select business…</option>
          {businesses.map((b) => (
            <option key={b.id} value={b.id}>{b.name} ({b.entity_type}, {b.ownership_percentage}%)</option>
          ))}
        </select>
      </div>

      <details>
        <summary style={{ cursor: 'pointer', fontSize: 13, color: '#2563eb' }}>
          + Add {businesses.length > 0 ? 'another' : 'a'} business for this client
        </summary>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
          <input
            placeholder="Business name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{ padding: 8, fontSize: 14 }}
          />
          <select value={entityType} onChange={(e) => setEntityType(e.target.value)} style={{ padding: 8, fontSize: 14 }}>
            <option value="individual">Individual</option>
            <option value="llc_single_member">Single-Member LLC</option>
            <option value="partnership">Partnership</option>
            <option value="s_corp">S-Corp</option>
            <option value="c_corp">C-Corp</option>
          </select>
          <select value={ownerType} onChange={(e) => setOwnerType(e.target.value)} style={{ padding: 8, fontSize: 14 }}>
            <option value="partner">Partner</option>
            <option value="shareholder">Shareholder</option>
            <option value="sole_owner">Sole owner</option>
          </select>
          <input
            type="number"
            placeholder="Ownership %"
            value={ownershipPct}
            onChange={(e) => setOwnershipPct(e.target.value)}
            style={{ padding: 8, fontSize: 14, width: 100 }}
          />
          <select value={storageProvider} onChange={(e) => setStorageProvider(e.target.value)} style={{ padding: 8, fontSize: 14 }}>
            <option value="google">Google Drive</option>
            <option value="microsoft">Microsoft OneDrive</option>
          </select>
          <button onClick={createBusiness} style={{ padding: '8px 12px', cursor: 'pointer' }}>+ Add business</button>
        </div>
        <p style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
          This links the business to this same client as an owner, so their personal upload tier is shared across all their businesses.
        </p>
      </details>
    </div>
  );
}
