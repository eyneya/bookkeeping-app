import { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import ConfirmDialog from './ConfirmDialog';
import { colors, fonts, spacing, button, input, select, table, alert } from '../theme';

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
      <h3 style={styles.title}>Period lock for this business</h3>
      <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center', marginBottom: spacing.lg }}>
        <input type="date" value={lockDate} onChange={(e) => setLockDate(e.target.value)} style={input.base} />
        <button onClick={lockPeriod} style={button.primary}>Lock through this date</button>
        {client?.locked_through_date && (
          <div style={{ ...alert.warning, display: 'inline-flex', alignItems: 'center', gap: spacing.sm }}>
            <span>&#128274; Locked through <strong>{client.locked_through_date.slice(0, 10)}</strong>. Edit access is restricted to admins (with logged overrides).</span>
            <button onClick={() => setConfirmUnlock(true)} style={{ ...button.smallDanger, marginLeft: spacing.sm }}>Unlock period</button>
          </div>
        )}
      </div>
      <p style={styles.note}>
        Use this once you've filed a return for a period, to prevent accidental edits. As admin, you can still override
        a lock on a specific action when it's genuinely needed — every override gets logged.
      </p>

      <div style={styles.divider} />

      <h3 style={styles.title}>Staff access for this business</h3>
      <p style={styles.note}>
        Only people listed here (plus admins, who always see everything) can access this business's data.
      </p>

      <div style={{ overflowX: 'auto' }}>
        <table style={table.container}>
          <thead>
            <tr>
              <th style={table.headerCell}>Email</th>
              <th style={table.headerCell}>Role</th>
              <th style={table.headerCell}>Granted</th>
              <th style={table.headerCell}>Action</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id} className="hoverable-row" style={table.row}>
                <td style={table.cell}>{s.email}</td>
                <td style={table.cell}>{s.role}</td>
                <td style={table.cell}>{s.granted_at?.slice(0, 10)}</td>
                <td style={table.cell}>
                  <button onClick={() => setRevokeUserId(s.id)} style={button.smallDanger}>Revoke</button>
                </td>
              </tr>
            ))}
            {staff.length === 0 && (
              <tr><td colSpan={4} style={{ ...table.cell, textAlign: 'center', color: colors.textSubtle, padding: spacing.xxl }}>No one has been explicitly granted access yet (admins can still see this business).</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center', marginTop: spacing.lg }}>
        <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)} style={{ ...select, flex: 1, maxWidth: 360 }}>
          <option value="">Select a preparer to grant access…</option>
          {availableUsers.map((u) => (
            <option key={u.id} value={u.id}>{u.email} ({u.role})</option>
          ))}
        </select>
        <button onClick={grantAccess} style={button.accent}>+ Grant access</button>
      </div>

      {revokeUserId && (
        <ConfirmDialog title="Revoke access" message="Revoke this person's access to this business?" confirmLabel="Revoke" onConfirm={revokeAccess} onCancel={() => setRevokeUserId(null)} />
      )}
      {confirmUnlock && (
        <ConfirmDialog title="Unlock period" message="This reopens the period to edits by any preparer with access, not just admins. Continue?" confirmLabel="Unlock" onConfirm={unlockPeriod} onCancel={() => setConfirmUnlock(false)} />
      )}
    </div>
  );
}

const styles = {
  title: { fontSize: fonts.sizeLg, fontWeight: fonts.weightSemibold, color: colors.navy, margin: `0 0 ${spacing.sm}px` },
  note: { fontSize: fonts.sizeXs, color: colors.textSubtle, margin: `0 0 ${spacing.lg}px` },
  divider: { borderTop: `1px solid ${colors.border}`, margin: `${spacing.xl}px 0` },
};
