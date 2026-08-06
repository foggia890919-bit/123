@echo off
rem KMD 재고 크롤러 실행.
rem
rem 예전에는 여기서 npm start 를 한 번 호출하고 끝냈다. 그래서 워커가 외부 요인으로
rem 죽으면(2026-07-30 사례) 아무도 되살리지 않아 크롤링이 영구 정지했다.
rem 이제는 감시자(scripts\supervise.mjs)가 워커를 띄우고, 죽으면 백오프를 두고 재시작한다.
rem 감시자가 로그 회전과 중복 실행 방지도 담당한다.
rem
rem 크롤러 로그: worker\logs\worker.log  (회전본: worker-YYYYMMDD-HHMMSS.log)
rem 감시자 기동 로그: worker\logs\supervisor.log
cd /d C:\temp\kmd-repo\worker
if not exist logs mkdir logs
node scripts\supervise.mjs >> logs\supervisor.log 2>&1
