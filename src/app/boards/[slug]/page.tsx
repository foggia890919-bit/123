"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { ChevronLeft, Pencil, Eye, ImageIcon, AlignLeft } from "lucide-react";

interface Post {
  id: string; title: string; content: string | null; images: string[]; imageUrls: string[];
  views: number; createdAt: string; user: { id: string; name: string | null };
}
interface BoardDetail {
  id: string; name: string; slug: string; description: string | null;
  type: "TEXT" | "IMAGE" | "MIXED"; posts: Post[]; _count: { posts: number };
}

export default function BoardPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: session } = useSession();
  const router = useRouter();
  const u = session?.user as { id?: string; role?: string } | undefined;

  const [board, setBoard] = useState<BoardDetail | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [canWrite, setCanWrite] = useState(false);
  const LIMIT = 20;

  const loadPosts = useCallback(async (p: number) => {
    setLoading(true);
    const r = await fetch(`/api/boards/${slug}/posts?page=${p}&limit=${LIMIT}`).then(r => r.json()).catch(() => ({}));
    if (r.board) { setBoard(r.board); setPosts(r.posts ?? []); setTotal(r.total ?? 0); }
    setLoading(false);
  }, [slug]);

  useEffect(() => { loadPosts(page); }, [loadPosts, page]);

  useEffect(() => {
    if (!u?.id || !board) return;
    if (u.role === "ADMIN") { setCanWrite(true); return; }
    fetch(`/api/admin/boards/${board.id}/editors`)
      .then(r => r.json())
      .then((eds: { userId: string }[]) => setCanWrite(eds.some(e => e.userId === u.id)))
      .catch(() => null);
  }, [u, board]);

  if (loading && !board) return <div className="max-w-4xl mx-auto px-4 py-12 text-center text-gray-400">불러오는 중…</div>;
  if (!board) return <div className="max-w-4xl mx-auto px-4 py-12 text-center text-gray-400">게시판을 찾을 수 없어요.</div>;

  const totalPages = Math.ceil(total / LIMIT);
  const isImage = board.type === "IMAGE";

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center gap-2 mb-6">
        <button onClick={() => router.push("/")} className="text-gray-400 hover:text-gray-600"><ChevronLeft className="w-5 h-5" /></button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">{board.name}</h1>
          {board.description && <p className="text-sm text-gray-400 mt-0.5">{board.description}</p>}
        </div>
        {canWrite && (
          <Link href={`/boards/${slug}/write`} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
            <Pencil className="w-4 h-4" />글쓰기
          </Link>
        )}
      </div>

      {posts.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <AlignLeft className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>아직 게시글이 없어요.</p>
          {canWrite && <p className="text-sm mt-1">첫 번째 글을 작성해 보세요!</p>}
        </div>
      ) : isImage ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {posts.map((p) => (
            <Link key={p.id} href={`/boards/${slug}/posts/${p.id}`} className="group rounded-xl overflow-hidden border border-gray-200 hover:shadow-md transition-all">
              <div className="aspect-video bg-gray-100 overflow-hidden">
                {p.imageUrls[0] ? (
                  <img src={p.imageUrls[0]} alt={p.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-300"><ImageIcon className="w-8 h-8" /></div>
                )}
              </div>
              <div className="p-3">
                <div className="text-sm font-semibold text-gray-900 truncate">{p.title}</div>
                <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-400">
                  <span>{p.user.name || "익명"}</span>
                  <span>·</span>
                  <span>{new Date(p.createdAt).toLocaleDateString("ko-KR")}</span>
                  <Eye className="w-3 h-3 ml-auto" /><span>{p.views}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y">
          {posts.map((p) => (
            <Link key={p.id} href={`/boards/${slug}/posts/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
              {p.imageUrls[0] && (
                <img src={p.imageUrls[0]} alt="" className="w-14 h-10 object-cover rounded-lg flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">{p.title}</div>
                {p.content && <div className="text-xs text-gray-400 truncate">{p.content}</div>}
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-xs text-gray-500">{p.user.name || "익명"}</div>
                <div className="text-xs text-gray-400 flex items-center gap-1 justify-end mt-0.5">
                  <span>{new Date(p.createdAt).toLocaleDateString("ko-KR")}</span>
                  <Eye className="w-3 h-3" /><span>{p.views}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-1 mt-6">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
            <button key={n} onClick={() => setPage(n)}
              className={`w-8 h-8 text-sm rounded-lg ${n === page ? "bg-blue-600 text-white" : "border border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
              {n}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
