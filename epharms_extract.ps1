param([string]$Mode = 'locate')   # 'locate' = open/find/report (clicks menu only) | 'run' = full export+read
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

# --- force DPI-UNAWARE so SetCursorPos uses virtualized(logical) coords; scale from system DPI ---
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Dpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }
"@
[void][Dpi]::SetProcessDPIAware()   # deterministic: system-DPI-aware -> UIA/Screen/SetCursorPos all physical, scale=1

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, IntPtr e);
}
"@
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class Enw {
  public delegate bool Proc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Proc p, IntPtr l);
  [DllImport("user32.dll")] public static extern void GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  public static List<IntPtr> WindowsOfPid(uint target) {
    var list = new List<IntPtr>();
    EnumWindows((h,l) => { if (IsWindowVisible(h)) { uint p; GetWindowThreadProcessId(h, out p); if (p==target) list.Add(h); } return true; }, IntPtr.Zero);
    return list;
  }
  public static string Cls(IntPtr h){ var s=new StringBuilder(256); GetClassName(h,s,256); return s.ToString(); }
  public static string Txt(IntPtr h){ var s=new StringBuilder(512); GetWindowTextW(h,s,512); return s.ToString(); }
}
"@

function MkStr([int[]]$codes) { -join ($codes | ForEach-Object { [char]$_ }) }
$NAME_JAEGO = MkStr @(0xC7AC,0xACE0,0xD604,0xD669)   # 재고현황 (inventory status)
$NAME_JOHOE = MkStr @(0xC870,0xD68C)                 # 조회 (query)
$NAME_EXCEL = MkStr @(0xC5D1,0xC140)                 # 엑셀 (excel)
$NAME_TODAY = MkStr @(0xC624,0xB298)                 # 오늘 (today)
$WORD_CONFIRM = MkStr @(0xD655,0xC778)               # 확인 (in overwrite-confirm dialog title)
$WORD_OPEN    = MkStr @(0xC5F4,0xB9BC)               # 열림 (in '파일 열림' file-open error title)
function NormName([string]$s) { if ($null -eq $s) { return '' } ($s -replace '\s','') }
$TYPE_WIN  = [System.Windows.Automation.ControlType]::Window
$TYPE_PANE = [System.Windows.Automation.ControlType]::Pane
$SC_DESC = [System.Windows.Automation.TreeScope]::Descendants
$TCOND = [System.Windows.Automation.Condition]::TrueCondition

$script:UIAW = 0.0; $script:UIAH = 0.0   # UIA screen size; set after root known
function ClickCenter($el) {
  # DPI-INDEPENDENT click: move to a screen FRACTION via normalized absolute mouse_event (0..65535).
  $r = $el.Current.BoundingRectangle
  $cx = $r.X + $r.Width/2; $cy = $r.Y + $r.Height/2
  $nx = [int]([math]::Round($cx / $script:UIAW * 65535))
  $ny = [int]([math]::Round($cy / $script:UIAH * 65535))
  # MOUSEEVENTF_MOVE|ABSOLUTE=0x8001, LEFTDOWN=0x02, LEFTUP=0x04
  [Win]::mouse_event(0x8001, $nx, $ny, 0, [IntPtr]::Zero); Start-Sleep -Milliseconds 150
  [Win]::mouse_event(0x02, 0, 0, 0, [IntPtr]::Zero); Start-Sleep -Milliseconds 60
  [Win]::mouse_event(0x04, 0, 0, 0, [IntPtr]::Zero)
  Write-Output ("  click norm @ ($nx,$ny)  [px " + [int]$cx + "," + [int]$cy + "]")
}

# --- main window (process with a real main window) ---
$proc = Get-Process -Name 'Drug1' -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Output 'ERR: Drug1 with a main window not found'; return }
$mainH = $proc.MainWindowHandle
Write-Output ("MAIN pid=" + $proc.Id + " hwnd=" + $mainH)

# --- restore + foreground (UIA tree is empty while minimized) ---
[void][Win]::ShowWindow($mainH, 9)        # SW_RESTORE
[void][Win]::SetForegroundWindow($mainH)
[void][Win]::BringWindowToTop($mainH)
Start-Sleep -Milliseconds 900

$rootEl = [System.Windows.Automation.AutomationElement]::RootElement
$rb = $rootEl.Current.BoundingRectangle
$script:UIAW = $rb.Width; $script:UIAH = $rb.Height
Write-Output ("UIA screen = " + [int]$script:UIAW + "x" + [int]$script:UIAH + " (DPI-independent normalized clicks)")
$pidCond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $proc.Id)
function ScanDesc {
  $wr = $rootEl.FindFirst([System.Windows.Automation.TreeScope]::Children, $pidCond)
  if (-not $wr) { return @() }
  $wr.FindAll($SC_DESC, $TCOND)
}

$desc = ScanDesc
Write-Output ("descendants=" + $desc.Count)

# --- find inventory window; if absent, open it via menu ---
function FindJaegoWindow($d) {
  foreach ($e in $d) {
    if ($e.Current.ControlType -eq $TYPE_WIN -and (NormName $e.Current.Name) -like ('*' + $NAME_JAEGO + '*')) { return $e }
  }
  $null
}
$jaego = FindJaegoWindow $desc
if (-not $jaego) {
  Write-Output 'inventory window not open -> opening via menu'
  $menu = $null
  foreach ($e in $desc) {
    if ($e.Current.ControlType -eq $TYPE_PANE -and (NormName $e.Current.Name) -like ('*' + $NAME_JAEGO + '*')) {
      $r = $e.Current.BoundingRectangle
      if ($r.Y -lt 220) { $menu = $e; break }   # menu strip is near the top
    }
  }
  if (-not $menu) { Write-Output 'ERR: inventory menu item not found'; return }
  Write-Output ("menu item: '" + $menu.Current.Name + "'")
  ClickCenter $menu
  Start-Sleep -Milliseconds 1800
  $desc = ScanDesc
  $jaego = FindJaegoWindow $desc
  if (-not $jaego) { Write-Output 'ERR: inventory window still not open after menu click'; return }
}
Write-Output ("JAEGO window: '" + $jaego.Current.Name + "'")

# --- force 재고현황 to be MAXIMIZED and ON TOP (so clicks land on it, not whatever else is open) ---
$childH = [IntPtr]$jaego.Current.NativeWindowHandle
[void][Win]::ShowWindow($mainH, 3)                 # SW_MAXIMIZE main window
Start-Sleep -Milliseconds 300
if ($childH -ne [IntPtr]::Zero) {
  [void][Win]::ShowWindow($childH, 3)              # SW_MAXIMIZE the 재고현황 MDI child -> covers siblings, consistent position
  [void][Win]::BringWindowToTop($childH)
}
[void][Win]::SetForegroundWindow($mainH)
Start-Sleep -Milliseconds 700
# verify it's still the inventory window after maximize
Write-Output ("fronted+maximized; child hwnd=" + $childH)

# --- buttons inside the inventory window (rects read AFTER maximize) ---
$panes = $jaego.FindAll($SC_DESC,
  (New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty, $TYPE_PANE)))
$btnJohoe = $null; $btnExcel = $null; $btnToday = $null
foreach ($p in $panes) {
  $r = $p.Current.BoundingRectangle
  $nn = NormName $p.Current.Name
  # 'today' radio is small (~123x40); match exact name
  if (-not $btnToday -and $nn -eq $NAME_TODAY -and $r.Width -ge 90 -and $r.Width -le 170 -and $r.Height -ge 25 -and $r.Height -le 55) { $btnToday = $p }
  # toolbar buttons are ~250x63; exclude help-text/labels by size
  if ($r.Width -lt 180 -or $r.Width -gt 320 -or $r.Height -lt 45 -or $r.Height -gt 90) { continue }
  if (-not $btnJohoe -and $nn -like ('*' + $NAME_JOHOE + '*')) { $btnJohoe = $p }
  if (-not $btnExcel -and $nn -like ('*' + $NAME_EXCEL + '*')) { $btnExcel = $p }
}
function RectInfo($el) { if (-not $el) { return 'NOT FOUND' }; $r = $el.Current.BoundingRectangle; ('rect=' + [int]$r.X + ',' + [int]$r.Y + ' ' + [int]$r.Width + 'x' + [int]$r.Height) }
Write-Output ("BTN query: " + (RectInfo $btnJohoe))
Write-Output ("BTN excel: " + (RectInfo $btnExcel))
if (-not $btnJohoe -or -not $btnExcel) { Write-Output 'ERR: query/excel button not found'; return }

if ($Mode -eq 'locate') { Write-Output 'OK locate: targets resolved (no query/excel click).'; return }

# --- run: today -> query -> excel -> handle Save dialog -> read file ---
# UNIQUE filename each run => no overwrite-confirm and no 'file is open' error.
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$expPath = "C:\Users\Public\ykstock_$stamp.xls"
# best-effort cleanup of older exports (skips any that are still open/locked)
Get-ChildItem -LiteralPath 'C:\Users\Public' -Filter 'ykstock_*.xls' -ErrorAction SilentlyContinue |
  ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }

# ensure 조회일자 = real system date by TYPING it (the 'today' radio is stale if ePharms started yesterday)
$today = Get-Date -Format 'yyyy-MM-dd'
$dateFields = @()
foreach ($p in $panes) { if ($p.Current.Name -match '^\d{4}-\d{2}-\d{2}$') { $dateFields += $p } }
Write-Output ("set date = " + $today + " into " + $dateFields.Count + " field(s)")
foreach ($d in $dateFields) {
  ClickCenter $d; Start-Sleep -Milliseconds 250
  [System.Windows.Forms.SendKeys]::SendWait('^a'); Start-Sleep -Milliseconds 120
  [System.Windows.Forms.SendKeys]::SendWait($today); Start-Sleep -Milliseconds 150
  [System.Windows.Forms.SendKeys]::SendWait('{TAB}'); Start-Sleep -Milliseconds 200
}

# re-assert ePharms on top before each click (a popup like KakaoTalk can steal focus during waits)
function Refront { [void][Win]::SetForegroundWindow($mainH); if ($childH -ne [IntPtr]::Zero) { [void][Win]::ShowWindow($childH,3); [void][Win]::BringWindowToTop($childH) }; Start-Sleep -Milliseconds 500 }

Refront
Write-Output 'click QUERY'
ClickCenter $btnJohoe
Write-Output 'waiting 15s for query to load...'
Start-Sleep -Seconds 15

Refront
Write-Output 'click EXCEL'
ClickCenter $btnExcel

# find any ePharms #32770 dialog
function FindDlg { $d=[IntPtr]::Zero; foreach ($h in [Enw]::WindowsOfPid([uint32]$proc.Id)) { if ($h -ne $mainH -and [Enw]::Cls($h) -eq '#32770') { $d=$h; break } }; $d }

# STATE-DRIVEN dialog pump: poll and react to whatever dialog is up (no fixed-timing assumptions).
#   - title has 확인  -> overwrite-confirm  -> press 예 (Alt+Y); default button is 아니오 so NEVER use Enter here
#   - title has 열림  -> 'file is open' err -> press Enter (OK); unique name means it shouldn't recur
#   - otherwise (save-as) -> Alt+N, clear, type unique path, Enter
$ok = $false
for ($i = 0; $i -lt 60; $i++) {
  if (Test-Path -LiteralPath $expPath) { $ok = $true }
  $d = FindDlg
  if ($d -eq [IntPtr]::Zero) { if ($ok) { break }; Start-Sleep -Milliseconds 400; continue }
  $title = [Enw]::Txt($d)
  [void][Enw]::SetForegroundWindow($d); Start-Sleep -Milliseconds 250
  if ($title.Contains($WORD_CONFIRM)) {
    Write-Output ("  overwrite-confirm -> 예 (Alt+Y)  [" + $title + "]")
    [System.Windows.Forms.SendKeys]::SendWait('%y')
  } elseif ($title.Contains($WORD_OPEN)) {
    Write-Output ("  file-open error -> OK  [" + $title + "]")
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  } else {
    Write-Output ("  save-as -> type path  [" + $title + "]")
    [System.Windows.Forms.SendKeys]::SendWait('%n'); Start-Sleep -Milliseconds 250
    [System.Windows.Forms.SendKeys]::SendWait('^a'); Start-Sleep -Milliseconds 150
    [System.Windows.Forms.SendKeys]::SendWait($expPath); Start-Sleep -Milliseconds 250
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  }
  Start-Sleep -Milliseconds 700
}
# close any leftover/extra dialog (ePharms may pop several save dialogs)
for ($k = 0; $k -lt 10; $k++) {
  $d = FindDlg
  if ($d -eq [IntPtr]::Zero) { break }
  $title = [Enw]::Txt($d); [void][Enw]::SetForegroundWindow($d); Start-Sleep -Milliseconds 150
  if ($title.Contains($WORD_CONFIRM)) { [System.Windows.Forms.SendKeys]::SendWait('%y') } else { [System.Windows.Forms.SendKeys]::SendWait('{ESC}') }
  Start-Sleep -Milliseconds 500
}
if (-not $ok) { Write-Output 'ERR: export file not created'; return }
$fexp = Get-Item -LiteralPath $expPath
Write-Output ("export saved: " + $fexp.FullName + " (" + $fexp.Length + " bytes)")

# --- read the saved file via Excel COM, aggregate by 표준코드 (col 19), sum 현재고(시점) (col 11) ---
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false
$wb = $xl.Workbooks.Open($expPath, 0, $true)
$ws = $wb.Worksheets.Item(1)
$data = $ws.UsedRange.Value2
$rows = $ws.UsedRange.Rows.Count
$agg = @{}
for ($r=2; $r -le $rows; $r++) {
  $name = [string]$data[$r,2]      # 상품명
  if ([string]::IsNullOrWhiteSpace($name)) { continue }
  $maker = [string]$data[$r,1]     # 제조사명
  $spec  = [string]$data[$r,3]     # 규격
  $code  = [string]$data[$r,19]    # 표준코드(바코드)
  $kind  = [string]$data[$r,15]    # 상품구분
  $cur = $data[$r,11]; $q = 0.0; if ($cur) { [double]::TryParse([string]$cur, [ref]$q) | Out-Null }
  $key = if ($code) { 'C:' + $code } else { 'N:' + $name + '|' + $spec }
  if (-not $agg.ContainsKey($key)) {
    $agg[$key] = [pscustomobject]@{ code=$code; name=$name; spec=$spec; maker=$maker; kind=$kind; stock=0.0; lots=0 }
  }
  $agg[$key].stock += $q; $agg[$key].lots += 1
}
Write-Output ("PARSED unique items=" + $agg.Count + " total stock=" + (($agg.Values | Measure-Object stock -Sum).Sum))
$out = Join-Path $env:USERPROFILE 'sales\stock_live.csv'
$agg.Values | Select-Object code, name, spec, maker, kind, stock, lots | Sort-Object name |
  Export-Csv -LiteralPath $out -NoTypeInformation -Encoding UTF8
Write-Output ("wrote " + $out)
try { $wb.Close($false); $xl.Quit() } catch {}
