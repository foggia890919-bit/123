// IndexedDB — 최근 파일 저장 + 공유(share_target)로 넘어온 파일 수신함.
// sw.js 도 같은 DB/스토어 이름을 사용한다 (스키마 변경 시 양쪽 동기화 필수).
const DB_NAME = "doc-viewer";
const DB_VERSION = 1;
const RECENTS = "recents";
const SHARED = "shared";
const RECENTS_CAP_BYTES = 200 * 1024 * 1024; // LRU 총량 상한
const RECENTS_CAP_COUNT = 50;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(RECENTS)) {
        db.createObjectStore(RECENTS, { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(SHARED)) {
        db.createObjectStore(SHARED, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result && "result" in result ? result.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

async function getAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function addRecent({ name, size, format, blob }) {
  const db = await openDB();
  const all = await getAll(RECENTS);
  // 같은 이름+크기는 기존 항목 갱신(중복 방지)
  const dupes = all.filter((r) => r.name === name && r.size === size);
  await tx(db, RECENTS, "readwrite", (s) => {
    dupes.forEach((d) => s.delete(d.id));
    s.add({ name, size, format, blob, ts: Date.now() });
  });
  await enforceCap(db);
}

async function enforceCap(db) {
  const all = (await getAll(RECENTS)).sort((a, b) => b.ts - a.ts);
  let total = 0;
  const evict = [];
  all.forEach((r, i) => {
    total += r.size;
    if (i >= RECENTS_CAP_COUNT || total > RECENTS_CAP_BYTES) evict.push(r.id);
  });
  if (evict.length) {
    await tx(db, RECENTS, "readwrite", (s) => evict.forEach((id) => s.delete(id)));
  }
}

export async function listRecents() {
  return (await getAll(RECENTS)).sort((a, b) => b.ts - a.ts);
}

export async function deleteRecent(id) {
  const db = await openDB();
  await tx(db, RECENTS, "readwrite", (s) => s.delete(id));
}

export async function clearRecents() {
  const db = await openDB();
  await tx(db, RECENTS, "readwrite", (s) => s.clear());
}

/** share_target 으로 SW 가 넣어둔 파일을 꺼내고 수신함을 비운다. */
export async function takeShared() {
  const db = await openDB();
  const all = await getAll(SHARED);
  if (all.length) await tx(db, SHARED, "readwrite", (s) => s.clear());
  if (!all.length) return null;
  const latest = all.sort((a, b) => b.ts - a.ts)[0];
  return new File([latest.blob], latest.name || "공유된 파일", { type: latest.blob.type });
}

/** 브라우저 임의 삭제(특히 iOS 7일 정책) 방지를 위해 영구 저장 요청 */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      await navigator.storage.persist();
    }
  } catch {
    /* 미지원 브라우저 — 무시 */
  }
}
