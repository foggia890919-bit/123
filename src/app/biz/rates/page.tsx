"use client";

import { BizLayout } from "@/app/biz/page";
import { Calculator, AlertCircle } from "lucide-react";

export default function RatesPage() {
  return (
    <BizLayout>
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">요율 업데이트</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            법인 단위 제약사별 요율 매핑 (관리자 통합 요율 위에 비즈 오버라이드)
          </p>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-2 text-sm text-amber-900">
              <p className="font-semibold">
                이 페이지는 사용자 확인 후 구현됩니다.
              </p>
              <p>
                관리자 페이지의 요율표(통합검색용)와 비즈관리 요율(법인 운영
                업체별 매칭)의 관계를 확정한 뒤 작업 예정입니다.
              </p>
              <ul className="list-disc list-inside text-xs space-y-1 text-amber-800 pt-1">
                <li>
                  관리자 요율 = `/api/admin/rates` 의 `MedicationCompany` +
                  `MemberCompanyRate` (멤버 단위 요율 오버라이드)
                </li>
                <li>
                  비즈관리 요율 = 법인 단위로 운영 업체별 요율을 일괄 조정·동기화
                </li>
                <li>
                  추가수수료(이관처 미지급)는 별도 메뉴 →{" "}
                  <span className="font-mono">/biz/corp-rates</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 text-sm text-gray-600 space-y-2">
          <div className="flex items-center gap-2 font-semibold text-gray-800">
            <Calculator className="w-4 h-4" />
            구현 시 들어갈 기능 (확정 후 변경 가능)
          </div>
          <ul className="list-disc list-inside text-xs space-y-1">
            <li>법인 선택 → 해당 법인이 운영하는 업체 목록 조회</li>
            <li>제약사별 요율 일괄 조정 (관리자 요율 대비 +/- %p)</li>
            <li>엑셀 템플릿 다운로드(세로형: 제약사명 / 요율%) → 매핑 후 일괄 업로드</li>
            <li>요율 변경 이력 추적 (언제 누가 무엇을 바꿨는지)</li>
          </ul>
        </div>
      </div>
    </BizLayout>
  );
}
