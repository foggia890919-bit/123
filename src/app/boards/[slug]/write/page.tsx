"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { ChevronLeft, ImagePlus, X } from "lucide-react";
import Link from "next/link";

export default function WritePostPage() {
  const { slug } = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");
  const { data: session, status } = useSession();
  const router = useRouter();
  const u = session?.user as { id?: string; role?: string } | undefined;

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [imageKeys, setImageKeys] = useState<string[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [boardName, setBoardName] = useState("");
  const [boardType, setBoardType] = useState<"TEXT" | "IMAGE" | "MIXED">("MIXED");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Auth check
  useEffect(() => {
    if (status === "loading") return;
    if (!u?.id) { router.replace(`/login?callbackUrl=/boards/${slug}/write`); return; }
    setAuthChecked(true);
  }, [status, u, slug, router]);

  // Load board info
  useEffect(() => {
    fetch(`/api/boards/${slug}/posts?limit=1`)
      .then(r => r.json())
      .then(d => { if (d.board) { setBoardName(d.board.name); setBoardType(d.board.type); } })
      .catch(() => null);
  }, [slug]);

  // Load existing post if editing
  useEffect(() => {
    if (!editId) return;
    fetch(`/api/boards/${slug}/posts/${editId}`)
      .then(r => r.json())
      .then(p => {
        setTitle(p.title || "");
        setContent(p.content || "");
        setImageKeys(p.images || []);
        setImagePreviews(p.imageUrls || []);
      });
  }, [editId, slug]);

  async function addImages(files: FileList) {
    setUploading(true);
    for (const file of Array.from(files)) {
      const dataUri = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/upload/post-image", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUri }),
      }).then(r => r.json()).catch(() => ({}));
      if (res.key) {
        setImageKeys(ks => [...ks, res.key]);
        setImagePreviews(ps => [...ps, res.url]);
      }
    }
    setUploading(false);
  }

  function removeImage(i: number) {
    setImageKeys(ks => ks.filter((_, j) => j !== i));
    setImagePreviews(ps => ps.filter((_, j) => j !== i));
  }

  async function submit() {
    if (!title.trim()) return alert("제목을 입력해주세요.");
    setSaving(true);
    const payload = { title, content, images: imageKeys };
    if (editId) {
      await fetch(`/api/boards/${slug}/posts/${editId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      router.push(`/boards/${slug}/posts/${editId}`);
    } else {
      const r = await fetch(`/api/boards/${slug}/posts`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      }).then(r => r.json());
      if (r.id) router.push(`/boards/${slug}/posts/${r.id}`);
    }
    setSaving(false);
  }

  if (!authChecked) return null;

  const showContent = boardType !== "IMAGE";
  const showImages = boardType !== "TEXT";

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center gap-2 mb-6">
        <Link href={`/boards/${slug}`} className="text-gray-400 hover:text-gray-600"><ChevronLeft className="w-5 h-5" /></Link>
        <span className="text-sm text-gray-400">{boardName}</span>
        <span className="text-sm text-gray-400">/</span>
        <span className="text-sm font-medium text-gray-700">{editId ? "글 수정" : "글쓰기"}</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <input
          className="w-full text-lg font-semibold border-b border-gray-200 pb-3 outline-none placeholder:text-gray-300 focus:border-blue-400 transition-colors"
          placeholder="제목을 입력하세요"
          value={title}
          onChange={e => setTitle(e.target.value)}
        />

        {showContent && (
          <textarea
            className="w-full min-h-48 text-sm text-gray-800 outline-none resize-none placeholder:text-gray-300 leading-relaxed"
            placeholder={boardType === "TEXT" ? "내용을 입력하세요" : "내용을 입력하세요 (선택)"}
            value={content}
            onChange={e => setContent(e.target.value)}
          />
        )}

        {showImages && (
          <div className="space-y-3">
            {imagePreviews.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                {imagePreviews.map((url, i) => (
                  <div key={i} className="relative group">
                    <img src={url} alt="" className="w-full rounded-xl border border-gray-200 object-cover aspect-video" />
                    <button onClick={() => removeImage(i)} className="absolute top-2 right-2 bg-black/50 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 px-4 py-2 border border-dashed border-gray-300 rounded-xl text-sm text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors w-full justify-center"
            >
              <ImagePlus className="w-4 h-4" />
              {uploading ? "업로드 중…" : "이미지 추가"}
            </button>
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
              onChange={e => e.target.files && addImages(e.target.files)} />
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <Link href={`/boards/${slug}`} className="px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">취소</Link>
          <button onClick={submit} disabled={saving || uploading || !title.trim()}
            className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? "저장 중…" : editId ? "수정 완료" : "게시하기"}
          </button>
        </div>
      </div>
    </div>
  );
}
