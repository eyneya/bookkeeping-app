import Modal from './Modal';

/** Render conditionally: {confirmState && <ConfirmDialog ... />} */
export default function ConfirmDialog({ title = 'Are you sure?', message, confirmLabel = 'Confirm', danger = true, onConfirm, onCancel }) {
  return (
    <Modal title={title} onClose={onCancel} width={360}>
      <p style={{ fontSize: 14, color: '#333' }}>{message}</p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={onCancel} style={{ padding: '8px 12px', cursor: 'pointer' }}>Cancel</button>
        <button
          onClick={onConfirm}
          style={{ padding: '8px 12px', cursor: 'pointer', background: danger ? '#dc2626' : '#2563eb', color: 'white', border: 'none', borderRadius: 4 }}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
