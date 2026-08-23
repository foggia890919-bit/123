// HWPX 렌더러 — 자체 OWPML 파서 (문단·표·이미지 기본 충실도)
import { loadScript } from "../util.js";

export async function render(file, container) {
  await loadScript("lib/jszip.min.js");

  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error("HWPX 파일을 열 수 없습니다. 파일이 손상되었을 수 있습니다.");
  }

  const sectionNames = Object.keys(zip.files)
    .filter((n) => /^Contents\/section\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
  if (!sectionNames.length) throw new Error("본문(section)을 찾을 수 없는 HWPX 파일입니다.");

  // content.hpf 매니페스트: 이미지 id → 패키지 내 경로
  const binMap = new Map();
  const hpf = zip.file("Contents/content.hpf");
  if (hpf) {
    const doc = new DOMParser().parseFromString(await hpf.async("string"), "text/xml");
    for (const item of doc.getElementsByTagName("*")) {
      if (item.localName !== "item") continue;
      const id = item.getAttribute("id");
      const href = item.getAttribute("href");
      if (id && href) binMap.set(id, href);
    }
  }

  const objectUrls = [];
  async function imageUrl(idRef) {
    let path = binMap.get(idRef);
    if (!path) {
      // 매니페스트에 없으면 BinData 에서 이름으로 탐색
      path = Object.keys(zip.files).find((n) => n.includes("BinData/" + idRef));
    }
    const entry = path && (zip.file(path) || zip.file(path.replace(/^\//, "")));
    if (!entry) return null;
    const blob = await entry.async("blob");
    const url = URL.createObjectURL(blob);
    objectUrls.push(url);
    return url;
  }

  const wrap = document.createElement("div");
  wrap.className = "hwpx-doc";
  container.appendChild(wrap);

  const byLocal = (el, name) =>
    [...el.children].filter((c) => c.localName === name);

  function textOfRun(run) {
    let out = "";
    for (const child of run.children) {
      if (child.localName === "t") out += child.textContent;
      else if (child.localName === "lineBreak" || child.localName === "br") out += "\n";
      else if (child.localName === "tab") out += "\t";
    }
    return out;
  }

  async function renderParagraph(p, target) {
    const el = document.createElement("p");
    el.className = "hwpx-p";
    let hasContent = false;
    for (const run of p.getElementsByTagName("*")) {
      if (run.localName !== "run") continue;
      const text = textOfRun(run);
      if (text) {
        el.appendChild(document.createTextNode(text));
        hasContent = true;
      }
      // 그림 개체
      for (const pic of run.children) {
        if (pic.localName !== "pic" && pic.localName !== "picture") continue;
        for (const imgEl of pic.getElementsByTagName("*")) {
          if (imgEl.localName !== "img") continue;
          const ref = imgEl.getAttribute("binaryItemIDRef") || imgEl.getAttribute("bindata");
          if (!ref) continue;
          const url = await imageUrl(ref);
          if (url) {
            const img = document.createElement("img");
            img.className = "hwpx-img";
            img.src = url;
            el.appendChild(img);
            hasContent = true;
          }
        }
      }
    }
    if (!hasContent) el.innerHTML = "&nbsp;"; // 빈 줄 유지
    target.appendChild(el);
  }

  async function renderTable(tbl, target) {
    const table = document.createElement("table");
    table.className = "hwpx-table";
    for (const tr of tbl.getElementsByTagName("*")) {
      if (tr.localName !== "tr") continue;
      const rowEl = document.createElement("tr");
      for (const tc of byLocal(tr, "tc")) {
        const cellEl = document.createElement("td");
        const span = tc.getElementsByTagName("*");
        for (const s of span) {
          if (s.localName === "cellSpan") {
            const c = parseInt(s.getAttribute("colSpan") || "1", 10);
            const r = parseInt(s.getAttribute("rowSpan") || "1", 10);
            if (c > 1) cellEl.colSpan = c;
            if (r > 1) cellEl.rowSpan = r;
          }
        }
        for (const sub of tc.getElementsByTagName("*")) {
          if (sub.localName === "p") await renderParagraph(sub, cellEl);
        }
        rowEl.appendChild(cellEl);
      }
      table.appendChild(rowEl);
    }
    target.appendChild(table);
  }

  try {
    for (const name of sectionNames) {
      const xml = await zip.file(name).async("string");
      const doc = new DOMParser().parseFromString(xml, "text/xml");
      const root = doc.documentElement;
      // 최상위 문단만 순회 (표 안의 문단은 표 렌더에서 처리)
      for (const node of root.children) {
        if (node.localName !== "p") continue;
        const tables = node.getElementsByTagName("*");
        let hasTable = false;
        for (const t of tables) {
          if (t.localName === "tbl") {
            hasTable = true;
            await renderTable(t, wrap);
          }
        }
        if (!hasTable) await renderParagraph(node, wrap);
      }
    }
  } catch {
    throw new Error("HWPX 본문을 해석하는 중 오류가 발생했습니다.");
  }

  if (!wrap.children.length) throw new Error("표시할 내용을 찾지 못했습니다.");

  return {
    destroy() {
      objectUrls.forEach((u) => URL.revokeObjectURL(u));
    },
  };
}
