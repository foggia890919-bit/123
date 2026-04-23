"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { Eye, Users, ChevronLeft, ChevronRight, Pin, X, ImageIcon, AlignLeft } from "lucide-react";

interface Banner {
  id: string; title: string; subtitle: string | null; description: string | null;
  buttonText: string | null; buttonLink: string | null;
  imageUrl: string | null; bgColor: string | null;
}
interface Notice {
  id: string; title: string; content: string; category: string; isPinned: boolean; createdAt: string;
  showAsPopup?: boolean;
}
interface Post {
  id: string; title: string; content: string | null; imageUrls: string[];
  views: number; createdAt: string; user: { name: string | null };
}
interface Board {
  id: string; slug: string; name: string; description: string | null;
  type: "TEXT" | "IMAGE" | "MIXED"; posts: Post[];
}

const DEFAULT_BG = "from-blue-900 to-blue-700";

function NoticePopup({ notices, onClose }: { notices: Notice[]; onClose: () => void }) {
  const [idx, setIdx] = useState(0);
  const notice = notices[idx];
  if (!notice) return null;

  function dismissToday() {
    const dismissed: string[] = JSON.parse(localStorage.getItem("popup_dismissed") || "[]");
    const today = new Date().toDateString();
    dismissed.push(`${notice.id}:${today}`);
    localStorage.setItem("popup_dismissed", JSON.stringify(dismissed));
    if (idx < notices.length - 1) setIdx(i => i + 1);
    else onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">{notice.category}</span>
          {notices.length > 1 && (
            <span className="text-xs text-gray-400">{idx + 1} / {notices.length}</span>
          )}
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 ml-auto"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-4">
          <h2 className="text-base font-bold text-gray-900 mb-3">{notice.title}</h2>
          <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed max-h-60 overflow-auto">{notice.content}</pre>
        </div>
        <div className="flex items-center justify-between px-5 pb-5 pt-2 border-t border-gray-100">
          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
            <input type="checkbox" onChange={e => { if (e.target.checked) dismissToday(); }} />
            오늘 하루 보지 않기
          </label>
          <button onClick={() => { if (idx < notices.length - 1) setIdx(i => i + 1); else onClose(); }}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const [visits, setVisits] = useState<{ today: number; total: number } | null>(null);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [slide, setSlide] = useState(0);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [popupNotices, setPopupNotices] = useState<Notice[]>([]);
  const [showPopup, setShowPopup] = useState(false);
  const [boards, setBoards] = useState<Board[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/visits", { method: "POST" })
      .then(() => fetch("/api/visits"))
      .then(r => r.json()).then(setVisits).catch(() => null);

    fetch("/api/banners").then(r => r.json()).then(d => setBanners(Array.isArray(d) ? d : [])).catch(() => null);
    fetch("/api/notices").then(r => r.json()).then(d => setNotices(Array.isArray(d) ? d : [])).catch(() => null);
    fetch("/api/notices?popup=1").then(r => r.json()).then((d: Notice[]) => {
      if (!Array.isArray(d) || d.length === 0) return;
      const dismissed: string[] = JSON.parse(localStorage.getItem("popup_dismissed") || "[]");
      const today = new Date().toDateString();
      const visible = d.filter(n => !dismissed.includes(`${n.id}:${today}`));
      if (visible.length > 0) { setPopupNotices(visible); setShowPopup(true); }
    }).catch(() => null);

    // Load active boards with recent posts
    fetch("/api/boards-home").then(r => r.json()).then(d => setBoards(Array.isArray(d) ? d : [])).catch(() => null);
  }, []);

  const totalSlides = banners.length;
  const prev = useCallback(() => setSlide(s => (s - 1 + Math.max(totalSlides, 1)) % Math.max(totalSlides, 1)), [totalSlides]);
  const next = useCallback(() => setSlide(s => (s + 1) % Math.max(totalSlides, 1)), [totalSlides]);

  useEffect(() => {
    if (totalSlides <= 1) return;
    autoRef.current = setInterval(next, 5000);
    return () => { if (autoRef.current) clearInterval(autoRef.current); };
  }, [next, totalSlides]);

  const cur = banners[slide];

  return (
    <div className="flex flex-col">
      {showPopup && popupNotices.length > 0 && (
        <NoticePopup notices={popupNotices} onClose={() => setShowPopup(false)} />
      )}

      {/* ── 슬라이드 배너 ── */}
      <div className={`relative w-full bg-gradient-to-r ${cur?.bgColor || DEFAULT_BG} transition-all duration-700 overflow-hidden`}
        style={{ minHeight: 340 }}>
        {cur?.imageUrl && (
          <div className="absolute inset-0">
            <img src={cur.imageUrl} alt="" className="w-full h-full object-cover opacity-30" />
          </div>
        )}
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: "radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 20%, white 1px, transparent 1px)", backgroundSize: "60px 60px" }} />

        <div className="relative max-w-5xl mx-auto px-6 py-16 flex flex-col items-start justify-center" style={{ minHeight: 340 }}>
          <span className="text-xs font-semibold tracking-widest text-blue-200 uppercase mb-3">
            와이케이메디 | KMD Platform
          </span>
          {cur ? (
            <>
              <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-3 leading-tight drop-shadow">{cur.title}</h1>
              {cur.subtitle && <p className="text-lg text-blue-100 font-medium mb-2">{cur.subtitle}</p>}
              {cur.description && <p className="text-sm text-blue-200 mb-8 max-w-lg">{cur.description}</p>}
              {cur.buttonText && cur.buttonLink && (
                <Link href={cur.buttonLink}
                  className="inline-flex items-center gap-2 bg-white text-blue-700 font-bold px-6 py-3 rounded-xl shadow-lg hover:bg-blue-50 transition-all text-sm">
                  {cur.buttonText} →
                </Link>
              )}
            </>
          ) : (
            <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-3 leading-tight drop-shadow">Korea Medicine Data</h1>
          )}
        </div>

        {totalSlides > 1 && (
          <>
            <button onClick={prev} className="absolute left-3 top-1/2 -translate-y-1/2 bg-white/20 hover:bg-white/40 text-white rounded-full p-2 transition-all">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button onClick={next} className="absolute right-3 top-1/2 -translate-y-1/2 bg-white/20 hover:bg-white/40 text-white rounded-full p-2 transition-all">
              <ChevronRight className="w-5 h-5" />
            </button>
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
              {banners.map((_, i) => (
                <button key={i} onClick={() => setSlide(i)}
                  className={`w-2 h-2 rounded-full transition-all ${i === slide ? "bg-white scale-125" : "bg-white/40"}`} />
              ))}
            </div>
          </>
        )}

        {visits !== null && (
          <div className="absolute top-4 right-4 flex items-center gap-3 bg-white/10 backdrop-blur-sm px-3 py-1.5 rounded-full">
            <div className="flex items-center gap-1 text-xs text-blue-100">
              <Eye className="w-3 h-3" />
              <span>오늘 <span className="font-bold text-white">{visits.today.toLocaleString()}</span></span>
            </div>
            <span className="text-white/30">|</span>
            <div className="flex items-center gap-1 text-xs text-blue-100">
              <Users className="w-3 h-3" />
              <span>전체 <span className="font-bold text-white">{visits.total.toLocaleString()}</span></span>
            </div>
          </div>
        )}
      </div>

      {/* ── 게시판 섹션 ── */}
      <div className="max-w-5xl mx-auto px-6 py-8 w-full space-y-10">
        {boards.map((board) => (
          <BoardSection key={board.id} board={board} />
        ))}

        {/* ── 공지사항 ── */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="w-1 h-5 rounded bg-blue-600 inline-block"></span>
              <h2 className="text-base font-bold text-gray-900">공지사항</h2>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="grid grid-cols-12 text-xs font-semibold text-gray-500 bg-gray-50 border-b border-gray-200 px-4 py-2.5">
              <div className="col-span-1 text-center">분류</div>
              <div className="col-span-8 pl-2">제목</div>
              <div className="col-span-3 text-right">날짜</div>
            </div>
            {notices.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">등록된 공지사항이 없습니다.</div>
            ) : (
              notices.map((n) => (
                <div key={n.id} className="border-b border-gray-100 last:border-0">
                  <button onClick={() => setExpanded(expanded === n.id ? null : n.id)}
                    className="w-full grid grid-cols-12 items-center px-4 py-3 hover:bg-gray-50 transition-all text-left">
                    <div className="col-span-1 text-center">
                      {n.isPinned ? <Pin className="w-3.5 h-3.5 text-blue-500 inline" /> : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{n.category}</span>
                      )}
                    </div>
                    <div className="col-span-8 pl-2">
                      <span className={`text-sm ${n.isPinned ? "font-semibold text-blue-700" : "text-gray-800"}`}>
                        {n.isPinned && <span className="text-blue-500 mr-1">[필독]</span>}
                        {n.title}
                      </span>
                    </div>
                    <div className="col-span-3 text-right text-xs text-gray-400">
                      {new Date(n.createdAt).toLocaleDateString("ko-KR")}
                    </div>
                  </button>
                  {expanded === n.id && (
                    <div className="px-6 pb-5 pt-2 bg-blue-50 border-t border-blue-100">
                      <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{n.content}</pre>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function BoardSection({ board }: { board: Board }) {
  const isImage = board.type === "IMAGE";
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="w-1 h-5 rounded bg-blue-600 inline-block"></span>
          <h2 className="text-base font-bold text-gray-900">{board.name}</h2>
          {board.description && <span className="text-xs text-gray-400 hidden sm:inline">{board.description}</span>}
        </div>
        <Link href={`/boards/${board.slug}`} className="text-xs text-blue-600 hover:text-blue-800 font-medium">더보기 →</Link>
      </div>

      {board.posts.length === 0 ? (
        <div className="text-sm text-gray-400 py-4 text-center bg-gray-50 rounded-xl">아직 게시글이 없어요.</div>
      ) : isImage ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {board.posts.slice(0, 6).map((p) => (
            <Link key={p.id} href={`/boards/${board.slug}/posts/${p.id}`} className="group rounded-xl overflow-hidden border border-gray-200 hover:shadow-md transition-all">
              <div className="aspect-video bg-gray-100 overflow-hidden">
                {p.imageUrls[0] ? (
                  <img src={p.imageUrls[0]} alt={p.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-300"><ImageIcon className="w-8 h-8" /></div>
                )}
              </div>
              <div className="p-3">
                <div className="text-sm font-semibold text-gray-900 truncate">{p.title}</div>
                <div className="text-[11px] text-gray-400 mt-1">{new Date(p.createdAt).toLocaleDateString("ko-KR")}</div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y">
          {board.posts.slice(0, 5).map((p) => (
            <Link key={p.id} href={`/boards/${board.slug}/posts/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
              {p.imageUrls[0] ? (
                <img src={p.imageUrls[0]} alt="" className="w-14 h-10 object-cover rounded-lg flex-shrink-0" />
              ) : board.type === "MIXED" ? (
                <div className="w-14 h-10 bg-gray-100 rounded-lg flex-shrink-0 flex items-center justify-center text-gray-300">
                  <AlignLeft className="w-4 h-4" />
                </div>
              ) : null}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">{p.title}</div>
                {p.content && <div className="text-xs text-gray-400 truncate">{p.content}</div>}
              </div>
              <div className="text-xs text-gray-400 flex-shrink-0">{new Date(p.createdAt).toLocaleDateString("ko-KR")}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
