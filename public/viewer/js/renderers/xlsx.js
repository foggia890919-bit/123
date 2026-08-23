// XLSX/CSV 렌더러 — SheetJS. 시트 탭 + 대용량 시트 행 제한(더 보기).
import { loadScript, esc } from "../util.js";

const CHUNK_ROWS = 500;

export async function render(file, container) {
  await loadScript("lib/xlsx.full.min.js");

  let wb;
  try {
    wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  } catch {
    throw new Error("스프레드시트를 해석할 수 없습니다. 파일이 손상되었거나 암호화되어 있을 수 있습니다.");
  }
  if (!wb.SheetNames.length) throw new Error("시트가 없는 파일입니다.");

  const tabs = document.createElement("div");
  tabs.className = "sheet-tabs";
  const body = document.createElement("div");
  body.className = "sheet-body";
  container.appendChild(tabs);
  container.appendChild(body);

  function showSheet(name) {
    [...tabs.children].forEach((b) => b.classList.toggle("active", b.dataset.name === name));
    body.innerHTML = "";
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], {
      header: 1,
      raw: false,
      defval: "",
    });
    if (!rows.length) {
      body.innerHTML = '<p class="sheet-empty">빈 시트입니다.</p>';
      return;
    }
    const table = document.createElement("table");
    table.className = "sheet-table";
    body.appendChild(table);
    let rendered = 0;

    const more = document.createElement("button");
    more.className = "sheet-more";
    more.type = "button";

    function appendChunk() {
      const chunk = rows.slice(rendered, rendered + CHUNK_ROWS);
      const html = chunk
        .map(
          (r, i) =>
            `<tr>${r
              .map((c) => (rendered + i === 0 ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`))
              .join("")}</tr>`,
        )
        .join("");
      table.insertAdjacentHTML("beforeend", html);
      rendered += chunk.length;
      if (rendered < rows.length) {
        more.textContent = `더 보기 (${rendered.toLocaleString()} / ${rows.length.toLocaleString()}행)`;
        body.appendChild(more);
      } else {
        more.remove();
      }
    }
    more.addEventListener("click", appendChunk);
    appendChunk();
  }

  for (const name of wb.SheetNames) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sheet-tab";
    btn.dataset.name = name;
    btn.textContent = name;
    btn.addEventListener("click", () => showSheet(name));
    tabs.appendChild(btn);
  }
  showSheet(wb.SheetNames[0]);

  return { destroy() {} };
}
