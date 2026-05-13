import { google } from "googleapis";
import { Readable } from "stream";

function getDriveClient() {
  const email = process.env.GOOGLE_DRIVE_CLIENT_EMAIL;
  const key = process.env.GOOGLE_DRIVE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Google Drive credentials not configured");

  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key },
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

export function driveEnabled() {
  return !!(process.env.GOOGLE_DRIVE_CLIENT_EMAIL && process.env.GOOGLE_DRIVE_PRIVATE_KEY && process.env.GOOGLE_DRIVE_FOLDER_ID);
}

export async function uploadFileToDrive(
  buffer: Buffer,
  storedName: string,
  mimeType: string,
): Promise<{ fileId: string; viewUrl: string }> {
  const drive = getDriveClient();
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID!;

  const res = await drive.files.create({
    requestBody: {
      name: storedName,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: Readable.from(buffer),
    },
    fields: "id,webViewLink",
  });

  const fileId = res.data.id!;
  const viewUrl = res.data.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`;
  return { fileId, viewUrl };
}

export async function getDriveDownloadUrl(fileId: string): Promise<string> {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

export async function deleteDriveFile(fileId: string): Promise<void> {
  const drive = getDriveClient();
  await drive.files.delete({ fileId });
}
