import { useState } from 'react';
import { apiFetch } from '../api';

export default function UploadPanel({ clientId }) {
  const [docType, setDocType] = useState('bank_statement');
  const [aiProvider, setAiProvider] = useState('claude');
  const [status, setStatus] = useState(null);
  const [uploading, setUploading] = useState(false);

  const handleFiles = async (fileList) => {
    setUploading(true);
    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const file of Array.from(fileList)) {
      const form = new FormData();
      form.append('file', file);
      form.append('client_id', clientId);
      form.append('doc_type', docType);
      form.append('ai_provider', aiProvider);

      try {
        const res = await apiFetch('/api/documents/upload', { method: 'POST', body: form });
        if (res.ok) {
          successCount++;
        } else {
          errorCount++;
          const data = await res.json();
          errors.push(data.error);
        }
      } catch {
        errorCount++;
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
      <div style={{ marginBottom: 16 }}>
        <label style={{ marginRight: 16 }}>
          <input type="radio" checked={docType === 'bank_statement'} onChange={() => setDocType('bank_statement')} />
          {' '}Bank statement page(s)
        </label>
        <label>
          <input type="radio" checked={docType === 'invoice'} onChange={() => setDocType('invoice')} />
          {' '}Invoice / receipt
        </label>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 13, color: '#666', marginRight: 8 }}>Extraction engine:</label>
        <select value={aiProvider} onChange={(e) => setAiProvider(e.target.value)} style={{ padding: 6, fontSize: 13 }}>
          <option value="claude">Claude (accepts JPG, PNG, and PDF)</option>
          <option value="openai">ChatGPT / OpenAI (JPG and PNG only — no PDF)</option>
        </select>
        {aiProvider === 'openai' && (
          <span style={{ fontSize: 12, color: '#b45309', marginLeft: 8 }}>
            PDFs will fail with this engine — use Claude for PDFs, or convert to an image first.
          </span>
        )}
      </div>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
        style={{
          border: '2px dashed #ccc', borderRadius: 8, padding: 40, textAlign: 'center', color: '#888',
        }}
      >
        {uploading ? 'Processing…' : 'Drag photos or PDFs here, or click to choose files'}
        <input
          type="file"
          multiple
          accept="image/*,application/pdf"
          onChange={(e) => handleFiles(e.target.files)}
          style={{ display: 'block', margin: '16px auto 0' }}
        />
      </div>

      {status && (
        <p style={{ color: status.type === 'success' ? '#16a34a' : '#dc2626', marginTop: 16 }}>
          {status.message}
        </p>
      )}
    </div>
  );
}
