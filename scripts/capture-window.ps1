# Captures the main window of a running process to a PNG (used for in-game screenshots).
#   powershell -File scripts/capture-window.ps1 -Process lambdawars -Out docs/screenshots/x.png
# Uses PrintWindow, so only the window's own contents are captured, even when other windows cover it.
param(
  [string]$Process = 'lambdawars',
  [Parameter(Mandatory = $true)][string]$Out
)
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Win {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
[Win]::SetProcessDPIAware() | Out-Null
$p = Get-Process -Name $Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { Write-Error "No window for process $Process"; exit 1 }
$h = $p.MainWindowHandle
$r = New-Object Win+RECT
[Win]::GetClientRect($h, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $hgt = $r.Bottom - $r.Top
$bmp = New-Object System.Drawing.Bitmap $w, $hgt
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
# 1 = PW_CLIENTONLY, 2 = PW_RENDERFULLCONTENT (needed for DirectX windows)
[Win]::PrintWindow($h, $hdc, 3) | Out-Null
$g.ReleaseHdc($hdc)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
"saved $Out ($w x $hgt, title '$($p.MainWindowTitle)')"
