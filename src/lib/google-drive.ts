import { google, drive_v3 } from "googleapis";
import { Readable } from "stream";

// 요청당 한 번만 클라이언트 생성 (토큰 재발급 방지)
let _drive: drive_v3.Drive | null = null;

function getDriveClient(): drive_v3.Drive {
  if (_drive) return _drive;
  const email = process.env.GOOGLE_DRIVE_CLIENT_EMAIL;
  const key = process.env.GOOGLE_DRIVE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Google Drive credentials not configured");

  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key },
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  _drive = google.drive({ version: "v3", auth });
  return _drive;
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
    requestBody: { name: storedName, parents: [folderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: "id,webViewLink",
  });

  const fileId = res.data.id!;
  const viewUrl = res.data.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`;
  return { fileId, viewUrl };
}

// 여러 파일을 완전 병렬로 업로드
export async function uploadFilesBatch(
  items: { buffer: Buffer; storedName: string; mimeType: string }[],
): Promise<{ fileId: string; viewUrl: string }[]> {
  return Promise.all(items.map((item) => uploadFileToDrive(item.buffer, item.storedName, item.mimeType)));
}

export async function deleteDriveFile(fileId: string): Promise<void> {
  const drive = getDriveClient();
  await drive.files.delete({ fileId });
}
