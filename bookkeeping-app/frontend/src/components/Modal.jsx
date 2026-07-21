import { colors, fonts, radius, shadows } from '../theme';

export default function Modal({ title, onClose, children, width = 400 }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 41, 66, 0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        padding: '16px',
      }}
      className="fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: colors.white, borderRadius: radius.lg, padding: 0,
          width, maxWidth: '100%', maxHeight: '85vh', overflowY: 'auto',
          boxShadow: shadows.xl,
        }}
        className="fade-in-up"
      >
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '20px 24px',
          borderBottom: `1px solid ${colors.borderLight}`,
        }}>
          <h3 style={{ margin: 0, fontSize: fonts.sizeLg, fontWeight: fonts.weightSemibold, color: colors.navy }}>{title}</h3>
          <button
            onClick={onClose}
            style={{
              border: 'none', background: colors.gray100, fontSize: 18, cursor: 'pointer',
              color: colors.textMuted, width: 32, height: 32, borderRadius: radius.sm,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
          >
            &#215;
          </button>
        </div>
        <div style={{ padding: '20px 24px' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
