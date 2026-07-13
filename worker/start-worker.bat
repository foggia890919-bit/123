@echo off
rem KMD 재고 크롤러 실행 (로그: worker\logs\worker.log)
cd /d C:\temp\kmd-repo\worker
if not exist logs mkdir logs
echo [%date% %time%] worker starting >> logs\worker.log
call npm start >> logs\worker.log 2>&1
