import { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import ConfirmDialog from './ConfirmDialog';

export default function Staff({ clientId }) {
  const [staff, setStaff] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [revokeUserId, setRevokeUserId] = useState(null);
  const [client, setClient] = useState(null);
  const [lockDate, setLockDate] = useState(new Date().toISOString().slice(0, 10));
  const [confirmUnlock, setConfirmUnlock] = useState(false);

  const load = () => {
    apiFetch(`/api/clients/${clientId}/staff`).then((r) => r.json()).then(setStaff);
    apiFetch('/api/auth/users').then((r) => r.json()).then((data) => (Array.isArray(data) ? setAllUsers(data) : setAllUsers([])));
    apiFetch(`/api/clients/${clientId}`).then((r) => r.json()).then(setClient);
  };
  useEffect(load, [clientId]);

  const grantAccess = async () => {
    if (!selectedUserId) return;
    await apiFetch(`/api/clients/${clientId}/staff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: selectedUserId }),
    });
    setSelectedUserId('');
    load();
  };

  const revokeAccess = async () => {
    await apiFetch(`/api/clients/${clientId}/staff/${revokeUserId}`, { method: 'DELETE' });
    setRevokeUserId(null);
    load();
  };

  const lockPeriod = async () => {
    await apiFetch(`/api/clients/${clientId}/lock-period`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locked_through_date: lockDate }),
    });
    load();
  };

  const unlockPeriod = async () => {
    await apiFetch(`/api/clients/${clientId}/lock-period`, { method: 'DELETE' });
    setConfirmUnlock(false);
    load();
  };

  const staffUserIds = new Set(staff.map((s) => s.id));
  const availableUsers = allUsers.filter((u) => !staffUserIds.has(u.id));

  return (
    <div>
      <h3>Period lock for this business</h3>
      {client?.locked_through_date ? (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: 12, marginBottom: 24 }}>
          <p style={{ fontSize: 14, margin: 0 }}>
            🔒 Locked through <strong>{client.locked_through_date.slice(0, 10)}</strong>. Transactions, journal entries, and
            flag/unflag actions dated on or before this can't be created, edited, or deleted without an admin override.
          </p>
          <button onClick={() => setConfirmUnlock(true)} style={{ ...btn, marginTop: 8 }}>Unlock period</button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 24 }}>
          <input type="date" value={lockDate} onChange={(e) => setLockDate(e.target.value)} style={{ padding: 8, fontSize: 14 }} />
          <button onClick={lockPeriod} style={{ padding: '8px 12px', cursor: 'pointer' }}>Lock through this date</button>
        </div>
      )}
      <p style={{ fontSize: 12, color: '#888', marginTop: -16, marginBottom: 24 }}>
        Use this once you've filed a return for a period, to prevent accidental edits. As admin, you can still override
        a lock on a specific action when it's genuinely needed — every override gets logged.
      </p>

      <h3>Staff access for this business</h3>
      <p style={{ fontSize: 12, color: '#888' }}>
        Only people listed here (plus admins, who always see everything) can access this business's data.
      </p>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginBottom: 16 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
            <th style={cell}>Email</th>
            <th style={cell}>Role</th>
            <th style={cell}>Granted</th>
            <th style={cell}>Action</th>
          </tr>
        </thead>
        <tbody>
          {staff.map((s) => (
            <tr key={s.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={cell}>{s.email}</td>
              <td style={cell}>{s.role}</td>
              <td style={cell}>{s.granted_at?.slice(0, 10)}</td>
              <td style={cell}>
                <button onClick={() => setRevokeUserId(s.id)} style={btn}>Revoke</button>
              </td>
            </tr>
          ))}
          {staff.length === 0 && (
            <tr><td colSpan={4} style={{ ...cell, color: '#888' }}>No one has been explicitly granted access yet (admins can still see this business).</td></tr>
          )}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)} style={{ padding: 8, fontSize: 14 }}>
          <option value="">Select a preparer to grant access…</option>
          {availableUsers.map((u) => (
            <option key={u.id} value={u.id}>{u.email} ({u.role})</option>
          ))}
        </select>
        <button onClick={grantAccess} style={{ padding: '8px 12px', cursor: 'pointer' }}>+ Grant access</button>
      </div>

      {revokeUserId && (
        <ConfirmDialog
          title="Revoke access"
          message="Revoke this person's access to this business?"
          confirmLabel="Revoke"
          onConfirm={revokeAccess}
          onCancel={() => setRevokeUserId(null)}
        />
      )}
      {confirmUnlock && (
        <ConfirmDialog
          title="Unlock period"
          message="This reopens the period to edits by any preparer with access, not just admins. Continue?"
          confirmLabel="Unlock"
          onConfirm={unlockPeriod}
          onCancel={() => setConfirmUnlock(false)}
        />
      )}
    </div>
  );
}

const cell = { padding: '8px 6px' };
const btn = { padding: '4px 8px', fontSize: 12, cursor: 'pointer' };
