/**
 * Storage adapter factory. Both Google Drive and Microsoft OneDrive/SharePoint
 * adapters implement the same interface so the rest of the app never needs
 * to know which provider a given client uses:
 *
 *   uploadFile(fileBuffer, filename, folderId, mimeType) -> { fileId, webUrl }
 *   createClientFolder(clientName) -> { folderId, webUrl }
 *   downloadFile(fileId) -> Buffer
 *
 * Which provider a client uses is stored on the client record
 * (clients.storage_provider = 'google' | 'microsoft'), so you can mix
 * providers across your client base — e.g. Google Workspace clients stay
 * on Drive, Microsoft 365 clients go to OneDrive/SharePoint.
 */

const googleDriveAdapter = require('./googleDriveAdapter');
const oneDriveAdapter = require('./oneDriveAdapter');

function getStorageAdapter(provider) {
  if (provider === 'microsoft') return oneDriveAdapter;
  if (provider === 'google') return googleDriveAdapter;
  throw new Error(`Unknown storage provider: ${provider}. Use 'google' or 'microsoft'.`);
}

module.exports = { getStorageAdapter };
