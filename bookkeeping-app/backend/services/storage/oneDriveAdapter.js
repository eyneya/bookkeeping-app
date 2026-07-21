/**
 * Microsoft OneDrive/SharePoint adapter — uses an Azure AD app registration
 * with application (client credentials) permissions via Microsoft Graph.
 * This is the Microsoft equivalent of a Google service account: no user
 * has to sign in interactively, the app authenticates as itself.
 *
 * Azure setup (one-time):
 *   1. Register an app in Azure AD (portal.azure.com > App registrations)
 *   2. Add Application permission: Files.ReadWrite.All (admin consent required)
 *   3. Create a client secret
 *
 * Env vars needed:
 *   MS_TENANT_ID
 *   MS_CLIENT_ID
 *   MS_CLIENT_SECRET
 *   MS_DRIVE_ID              - the OneDrive/SharePoint drive to store files in
 *   MS_PARENT_FOLDER_ID      - the folder client subfolders get created inside
 */

const { ConfidentialClientApplication } = require('@azure/msal-node');

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

function getMsalClient() {
  return new ConfidentialClientApplication({
    auth: {
      clientId: process.env.MS_CLIENT_ID,
      authority: `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}`,
      clientSecret: process.env.MS_CLIENT_SECRET,
    },
  });
}

async function getAccessToken() {
  const msal = getMsalClient();
  const result = await msal.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });
  return result.accessToken;
}

async function graphFetch(path, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Microsoft Graph API error (${res.status}): ${errText}`);
  }
  return res;
}

async function createClientFolder(clientName) {
  const driveId = process.env.MS_DRIVE_ID;
  const parentId = process.env.MS_PARENT_FOLDER_ID;
  const res = await graphFetch(`/drives/${driveId}/items/${parentId}/children`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: clientName,
      folder: {},
      '@microsoft.graph.conflictBehavior': 'rename',
    }),
  });
  const data = await res.json();
  return { folderId: data.id, webUrl: data.webUrl };
}

async function uploadFile(fileBuffer, filename, folderId, mimeType) {
  const driveId = process.env.MS_DRIVE_ID;
  // Simple upload (fine for files under ~4MB, which covers scanned statements/invoices/xlsx exports)
  const res = await graphFetch(
    `/drives/${driveId}/items/${folderId}:/${encodeURIComponent(filename)}:/content`,
    {
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      body: fileBuffer,
    }
  );
  const data = await res.json();
  return { fileId: data.id, webUrl: data.webUrl };
}

async function downloadFile(fileId) {
  const driveId = process.env.MS_DRIVE_ID;
  const res = await graphFetch(`/drives/${driveId}/items/${fileId}/content`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = { createClientFolder, uploadFile, downloadFile };
