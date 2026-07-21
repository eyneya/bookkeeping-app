import Modal from './Modal';
import { colors, fonts, spacing, button } from '../theme';

/** Render conditionally: {confirmState && <ConfirmDialog ... />} */
export default function ConfirmDialog({ title = 'Are you sure?', message, confirmLabel = 'Confirm', danger = true, onConfirm, onCancel }) {
  return (
    <Modal title={title} onClose={onCancel} width={360}>
      <p style={{ fontSize: fonts.sizeBase, color: colors.gray700, lineHeight: fonts.lineHeightBody, margin: 0 }}>
        {message}
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.xl }}>
        <button onClick={onCancel} style={button.secondary}>Cancel</button>
        <button onClick={onConfirm} style={danger ? button.danger : button.primary}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
