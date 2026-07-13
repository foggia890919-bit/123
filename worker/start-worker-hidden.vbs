' KMD 재고 크롤러 — 창 없이 백그라운드 실행 (시작프로그램 등록용)
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """C:\temp\kmd-repo\worker\start-worker.bat""", 0, False
