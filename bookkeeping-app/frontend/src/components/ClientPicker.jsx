import { useEffect, useState } from 'react';
import { getCustomer, createClient, getCurrentUser } from '../api';
import { colors, fonts, spacing, button, input, select } from '../theme';

export default function ClientPicker({ customerId, onSelect, selectedClientId }) {
  const [businesses, setBusinesses] = useState([]);
  const [newName, setNewName] = useState('');
  const [entityType, setEntityType] = useState('llc_single_member');
  const [storageProvider, setStorageProvider] = useState('google');
  const [ownerType, setOwnerType] = useState('partner');
  const [ownershipPct, setOwnershipPct] = useState('100');
  const [ownerName, setOwnerName] = useState('');
  const [showForm, setShowForm] = useState(false);

  const loadBusinesses = () => { getCustomer(customerId).then((c) => setBusinesses(c.businesses || [])); };
  useEffect(loadBusinesses, [customerId]);

  const createBusiness = async () => {
    if (!newName.trim()) return;
    const customer = await getCustomer(customerId);
    const business = await createClient({
      name: newName, entity_type: entityType, storage_provider: storageProvider,
      customer_id: customerId, owner_type: ownerType, ownership_percentage: Number(ownershipPct),
      owner_name: ownerName || customer.name,
    });
    setNewName('');
    setOwnerName('');
    setShowForm(false);
    loadBusinesses();
    onSelect(business.id);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: fonts.sizeSm, fontWeight: fonts.weightMedium, color: colors.gray700 }}>Business:</label>
        <select
          value={selectedClientId || ''}
          onChange={(e) => onSelect(e.target.value)}
          style={{ ...select, minWidth: 200, flex: 1, maxWidth: 360 }}
        >
          <option value="" disabled>Select business…</option>
          {businesses.map((b) => (
            <option key={b.id} value={b.id}>{b.name} ({b.entity_type}, {b.ownership_percentage}%)</option>
          ))}
        </select>
        <button onClick={() => setShowForm(!showForm)} style={button.smallAccent}>+ New business</button>
      </div>

      {showForm && (
        <div className="slide-down" style={{ marginTop: spacing.md }}>
          <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap', marginBottom: spacing.sm }}>
            <input
              placeholder="Business name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={{ ...input.base, flex: 1, minWidth: 180 }}
              autoFocus
            />
            <select value={entityType} onChange={(e) => setEntityType(e.target.value)} style={{ ...select, minWidth: 150 }}>
              <option value="individual">Individual</option>
              <option value="llc_single_member">Single-Member LLC</option>
              <option value="partnership">Partnership</option>
              <option value="s_corp">S-Corp</option>
              <option value="c_corp">C-Corp</option>
            </select>
            <select value={ownerType} onChange={(e) => setOwnerType(e.target.value)} style={{ ...select, minWidth: 120 }}>
              <option value="partner">Partner</option>
              <option value="shareholder">Shareholder</option>
              <option value="sole_owner">Sole owner</option>
            </select>
            <input
              type="number" placeholder="Ownership %" value={ownershipPct}
              onChange={(e) => setOwnershipPct(e.target.value)}
              style={{ ...input.base, width: 110 }}
            />
            <select value={storageProvider} onChange={(e) => setStorageProvider(e.target.value)} style={{ ...select, minWidth: 150 }}>
              <option value="google">Google Drive</option>
              <option value="microsoft">Microsoft OneDrive</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center' }}>
            <input
              placeholder="Owner name (leave blank to use client name)"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              style={{ ...input.base, flex: 1, maxWidth: 300 }}
            />
            <button onClick={createBusiness} style={button.primary}>Add business</button>
            <button onClick={() => { setShowForm(false); setNewName(''); }} style={button.secondary}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
