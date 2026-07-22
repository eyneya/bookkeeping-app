import { useState } from 'react';
import { uploadDocument } from '../api';
import { colors, fonts, spacing, radius, button, input, select, alert } from '../theme';

export default function UploadPanel({ clientId }) {
  const [docType, setDocType] = useState('bank_statement');
  const [aiProvider, setAiProvider] = useState('claude');
  const [status, setStatus] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = async (fileList) => {
    setUploading(true);
    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const file of Array.from(fileList)) {
      try {
        await uploadDocument(file, { clientId, docType, aiProvider });
        successCount++;
      } catch (err) {
        errorCount++;
        errors.push(err.message);
      }
    }

    setUploading(false);
    setStatus({
      type: errorCount === 0 ? 'success' : 'error',
      message: `Processed ${successCount} file(s). ${errorCount > 0 ? `${errorCount} failed: ${errors[0]}` : ''}`,
    });
  };

  return (
    <div>
      <h3 style={styles.title}>Upload Documents</h3>
      <p style={styles.desc}>Upload bank statements, invoices, or receipts for AI-powered extraction.</p>

      <div style={{ display: 'flex', gap: spacing.xl, marginBottom: spacing.lg }}>
        <label style={styles.radioLabel}>
          <input type="radio" checked={docType === 'bank_statement'} onChange={() => setDocType('bank_statement')} style={{ accentColor: colors.teal }} />
          {' '}Bank statement page(s)
        </label>
        <label style={styles.radioLabel}>
          <input type="radio" checked={docType === 'invoice'} onChange={() => setDocType('invoice')} style={{ accentColor: colors.teal }} />
          {' '}Invoice / receipt
        </label>
      </div>

      <div style={{ display: 'flex', gap: spacing.sm, alignItems: 'center', marginBottom: spacing.lg, flexWrap: 'wrap' }}>
        <label style={{ fontSize: fonts.sizeSm, color: colors.textMuted, fontWeight: fonts.weightMedium }}>Extraction engine:</label>
        <select value={aiProvider} onChange={(e) => setAiProvider(e.target.value)} style={{ ...select, minWidth: 280 }}>
          <option value="claude">Claude (accepts JPG, PNG, and PDF)</option>
          <option value="openai">ChatGPT / OpenAI (JPG and PNG only — no PDF)</option>
        </select>
        {aiProvider === 'openai' && (
          <span style={{ fontSize: fonts.sizeXs, color: colors.warning, ...alert.warning, display: 'inline-block' }}>
            PDFs will fail with this engine — use Claude for PDFs.
          </span>
        )}
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        style={{
          ...styles.dropZone,
          border: `2px dashed ${dragOver ? colors.teal : colors.gray300}`,
          background: dragOver ? colors.infoBg : colors.gray50,
        }}
      >
        <div style={{ fontSize: 40, marginBottom: spacing.sm, color: dragOver ? colors.teal : colors.gray400 }}>
          {uploading ? (
            <span style={{ fontSize: fonts.sizeLg, color: colors.teal }}>Processing…</span>
          ) : (
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          )}
        </div>
        <p style={{ color: colors.textMuted, fontSize: fonts.sizeBase, margin: 0 }}>
          {uploading ? 'Extracting data with AI…' : 'Drag photos or PDFs here, or click to choose files'}
        </p>
        <input
          type="file"
          multiple
          accept="image/*,application/pdf"
          onChange={(e) => handleFiles(e.target.files)}
          style={{ display: 'block', margin: `${spacing.md} auto 0` }}
        />
      </div>

      {status && (
        <div style={{ ...alert[status.type], marginTop: spacing.lg }} className="slide-down">
          {status.message}
        </div>
      )}
    </div>
  );
}

const styles = {
  title: { fontSize: fonts.sizeLg, fontWeight: fonts.weightSemibold, color: colors.navy, margin: `0 0 ${spacing.xs}px` },
  desc: { fontSize: fonts.sizeSm, color: colors.textMuted, margin: `0 0 ${spacing.xl}px` },
  radioLabel: { fontSize: fonts.sizeBase, color: colors.text, cursor: 'pointer', display: 'flex', alignItems: 'center' },
  dropZone: {
    borderRadius: radius.lg,
    padding: spacing.xxxl,
    textAlign: 'center',
    transition: 'all 0.2s ease',
  },
};
