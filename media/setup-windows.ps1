# ============================================================
#   One-time setup for your website (Windows)
#
#   HOW TO RUN:
#   Right-click this file and choose "Run with PowerShell".
#   If Windows shows a blue "Yes / No" box, click Yes.
#
#   It installs Quarto, installs uv, and installs the small
#   set of Python packages listed in requirements.txt.
#   You only need to do this once.
# ============================================================

Write-Host ""
Write-Host "Step 1 of 3: Installing Quarto..." -ForegroundColor Cyan
winget install --id Posit.Quarto -e --accept-source-agreements --accept-package-agreements

Write-Host ""
Write-Host "Step 2 of 3: Installing uv (the Python package tool)..." -ForegroundColor Cyan
winget install --id astral-sh.uv -e --accept-source-agreements --accept-package-agreements

# Reload PATH so the tools just installed are found in this same window.
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","User") + ";" + `
            [System.Environment]::GetEnvironmentVariable("Path","Machine")

Write-Host ""
Write-Host "Step 3 of 3: Installing the Python packages..." -ForegroundColor Cyan
if (Get-Command uv -ErrorAction SilentlyContinue) {
    uv venv
    uv pip install -r requirements.txt
    Write-Host ""
    Write-Host "All done. You can close this window." -ForegroundColor Green
    Write-Host "Next: open this folder in VSCode and click Preview." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "uv was installed but is not visible yet." -ForegroundColor Yellow
    Write-Host "Please CLOSE this window and run this file one more time." -ForegroundColor Yellow
}

Write-Host ""
Read-Host "Press Enter to close"
