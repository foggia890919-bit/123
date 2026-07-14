#!/usr/bin/env tsx
// 진단: 서비스 계정이 폴더에 어떻게 보이는지, 사용자가 만든 시트가 잘 잡히는지 확인.
import { driveApi } from "../src/lib/google-sheets";

async function main() {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) { console.error("GOOGLE_DRIVE_FOLDER_ID 미설정"); process.exit(1); }

  console.log(`폴더 ID: ${folderId}\n`);

  // 1. 폴더 자체에 접근 가능한지
  try {
    const folder = await driveApi(`/files/${folderId}?fields=id,name,owners(displayName,emailAddress),permissions(id,emailAddress,role,type)`);
    console.log("=== 폴더 정보 ===");
    console.log(JSON.stringify(folder, null, 2));
  } catch (e) {
    console.error("폴더 접근 실패:", String(e).slice(0, 400));
    process.exit(1);
  }

  // 2. 폴더 안 모든 파일
  console.log("\n=== 폴더 안 파일 목록 ===");
  const list = await driveApi(`/files?q='${folderId}'+in+parents&fields=files(id,name,mimeType,owners(emailAddress))`);
  console.log(JSON.stringify(list, null, 2));

  // 3. "처방통계 데이터" 정확 매칭
  console.log("\n=== '처방통계 데이터' 매칭 ===");
  const q1 = `name='처방통계 데이터' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false and '${folderId}' in parents`;
  const m1 = await driveApi(`/files?q=${encodeURIComponent(q1)}&fields=files(id,name)`);
  console.log(JSON.stringify(m1, null, 2));

  // 4. "병원 실적 데이터" 매칭
  console.log("\n=== '병원 실적 데이터' 매칭 ===");
  const q2 = `name='병원 실적 데이터' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false and '${folderId}' in parents`;
  const m2 = await driveApi(`/files?q=${encodeURIComponent(q2)}&fields=files(id,name)`);
  console.log(JSON.stringify(m2, null, 2));
}

main().catch((e) => { console.error("[ERROR]", e); process.exit(1); });
