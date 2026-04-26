"use client";

import { useRouter } from "next/navigation";
import { LogIn, UserPlus, Search } from "lucide-react";

interface Props {
  onClose: () => void;
}

export default function GuestGateModal({ onClose }: Props) {
  const router = useRouter();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 text-center space-y-5">
        <div className="flex justify-center">
          <div className="w-14 h-14 bg-blue-50 rounded-full flex items-center justify-center">
            <Search className="w-7 h-7 text-blue-500" />
          </div>
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-900">무료 검색 3회를 모두 사용했어요</h2>
          <p className="text-sm text-gray-500 mt-2">
            회원가입 후 무제한으로 검색하고<br />제안서 기능까지 이용하실 수 있어요.
          </p>
        </div>
        <div className="space-y-2">
          <button
            onClick={() => router.push("/register")}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors"
          >
            <UserPlus className="w-4 h-4" />무료 회원가입
          </button>
          <button
            onClick={() => router.push("/login")}
            className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg flex items-center justify-center gap-2 transition-colors"
          >
            <LogIn className="w-4 h-4" />로그인
          </button>
        </div>
        <button
          onClick={onClose}
          className="text-xs text-gray-400 hover:text-gray-600 underline"
        >
          닫기
        </button>
      </div>
    </div>
  );
}
