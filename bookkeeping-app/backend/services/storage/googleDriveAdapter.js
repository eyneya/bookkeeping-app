/**
 * Google Drive adapter — uses a Google Cloud service account (matches your
 * existing admin app plan). The service account must be shared on (or own)
 * the parent Drive folder you want client subfolders created under.
 *
 * Env vars needed:
 *   GOOGLE_SERVICE_ACCOUNT_JSON  - the full JSON key, as a string (or path — see below)
 *   GOOGLE_DRIVE_PARENT_FOLDER_ID - the folder client subfolders get created inside
 */

const { google } = require('googleapis');
const { Readable } = require('stream');

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
}

async function getDriveClient() {
  const auth = getAuth();
  return google.drive({ version: 'v3', auth });
}

async function createClientFolder(clientName) {
  const drive = await getDriveClient();
  const res = await drive.files.create({
    requestBody: {
      name: clientName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID],
    },
    fields: 'id, webViewLink',
  });
  return { folderId: res.data.id, webUrl: res.data.webViewLink };
}

async function uploadFile(fileBuffer, filename, folderId, mimeType) {
  const drive = await getDriveClient();
  const res = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType, body: Readable.from(fileBuffer) },
    fields: 'id, webViewLink',
  });
  return { fileId: res.data.id, webUrl: res.data.webViewLink };
}

async function downloadFile(fileId) {
  const drive = await getDriveClient();
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
  return Buffer.from(res.data);
}

module.exports = { createClientFolder, uploadFile, downloadFile };
