-- DealerType enum 에 PHARMACY, CSO 값 추가.
-- Supabase SQL Editor 에서 한 번 실행. 이미 있으면 IF NOT EXISTS 가 알아서 스킵.
--
-- 배경: 마이페이지에서 등록되는 본인 사업자가 전부 "병의원(원외)" 로 들어가던 문제.
-- 약사가 등록하는 약국, 컨설팅/CSO 회사 같은 일반 사업자도 명시할 수 있게 enum 확장.
-- null 은 그대로 "병의원(원외)" 의미로 유지 (기존 데이터 호환).

ALTER TYPE "DealerType" ADD VALUE IF NOT EXISTS 'PHARMACY';
ALTER TYPE "DealerType" ADD VALUE IF NOT EXISTS 'CSO';

-- 적용 확인:
-- SELECT enum_range(NULL::"DealerType");
