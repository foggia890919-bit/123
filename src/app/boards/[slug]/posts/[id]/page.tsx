"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ChevronLeft, Eye, Trash2, Pencil } from "lucide-react";
import Link from "next/link";

interface Post {
  id: string; title: string; content: string | null; images: string[]; imageUrls: string[];
  views: number; createdAt: string; updatedAt: string;
  user: { id: string; name: string | null };
  board: { slug: string; name: string; type: string };
}

export default function PostDetailPage() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const { data: session } = useSession();
  const router = useRouter();
  const u = session?.user as { id?: string; role?: string } | undefined;

  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/boards/${slug}/posts/${id}`)
      .then(r => r.json())
      .then(d => { setPost(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [slug, id]);

  async function deletePost() {
    if (!confirm("이 글을 삭제할까요?")) return;
    await fetch(`/api/boards/${slug}/posts/${id}`, { method: "DELETE" });
    router.push(`/boards/${slug}`);
  }

  if (loading) return <div className="max-w-3xl mx-auto px-4 py-12 text-center text-gray-400">불러오는 중…</div>;
  if (!post) return <div className="max-w-3xl mx-auto px-4 py-12 text-center text-gray-400">글을 찾을 수 없어요.</div>;

  const isOwner = u?.id === post.user.id;
  const isAdmin = u?.role === "ADMIN";

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center gap-2 mb-6">
        <Link href={`/boards/${slug}`} className="text-gray-400 hover:text-gray-600"><ChevronLeft className="w-5 h-5" /></Link>
        <span className="text-sm text-gray-400">{post.board.name}</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h1 className="text-xl font-bold text-gray-900 mb-3">{post.title}</h1>
        <div className="flex items-center gap-3 text-sm text-gray-400 mb-6 pb-4 border-b border-gray-100">
          <span>{post.user.name || "익명"}</span>
          <span>·</span>
          <span>{new Date(post.createdAt).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })}</span>
          <span className="flex items-center gap-1 ml-auto"><Eye className="w-4 h-4" />{post.views}</span>
          {(isOwner || isAdmin) && (
            <>
              <Link href={`/boards/${slug}/write?edit=${id}`} className="flex items-center gap-1 text-blue-500 hover:text-blue-700">
                <Pencil className="w-3.5 h-3.5" />수정
              </Link>
              <button onClick={deletePost} className="flex items-center gap-1 text-red-400 hover:text-red-600">
                <Trash2 className="w-3.5 h-3.5" />삭제
              </button>
            </>
          )}
        </div>

        {post.content && (
          <div className="prose max-w-none text-gray-800 text-sm leading-relaxed whitespace-pre-wrap mb-6">
            {post.content}
          </div>
        )}

        {post.imageUrls.length > 0 && (
          <div className="space-y-4">
            {post.imageUrls.map((url, i) => (
              <img key={i} src={url} alt={`이미지 ${i + 1}`} className="w-full rounded-xl border border-gray-100" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
