export default function Modal({ title, onClose, children, width = 400 }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'white', borderRadius: 8, padding: 20, width, maxWidth: '90vw', maxHeight: '85vh', overflowY: 'auto' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: '#888' }}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
