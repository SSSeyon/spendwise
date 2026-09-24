<#
  bump-version.ps1 - update every place the app version is written, in one go.

  There are SIX spots, and missing any one of them is a real deploy hazard:
  the ?v= query strings are what bust the service-worker cache, so a version
  that isn't bumped there means the fix never reaches an installed device.

    app.js      1. const APP_VERSION='vX.Y.Z';
                2. <div>Version: vX.Y.Z</div>      (App Info panel)
                3. the single release note         (App Info shows ONLY the latest)
    index.html  4. styles.css?v=X.Y.Z
                5. <span class="ver-lbl" ...>vX.Y.Z</span>
                6. app.js?v=X.Y.Z

  sw.js CACHE is deliberately NOT touched: index.html, app.js and styles.css are
  excluded from the precache list (see sw.js), so ?v= busting is sufficient.
  Bump sw.js by hand only if you change the precached STATIC assets.

  Usage:
    .\bump-version.ps1 -Version 4.4.19 -Note "What changed, in one user-facing sentence."
    .\bump-version.ps1 -Version 4.4.19 -Note "..." -WhatIf   # preview only
#>
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
  [Parameter(Mandatory=$true)][string]$Note,
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$root    = Split-Path -Parent $MyInvocation.MyCommand.Path
$appJs   = Join-Path $root 'app.js'
$indexHt = Join-Path $root 'index.html'
foreach ($f in @($appJs, $indexHt)) {
  if (-not (Test-Path $f)) { throw "Missing $f" }
}

# Discover the current version from the one spot that is unambiguous.
# -Encoding UTF8 is REQUIRED: PS 5.1 Get-Content defaults to the system ANSI
# codepage for a BOM-less file, which turns every UTF-8 character (naira signs,
# arrows, em-dashes) into mojibake the moment it is written back out.
$app = Get-Content $appJs -Raw -Encoding UTF8
if ($app -notmatch "const APP_VERSION='v(?<v>\d+\.\d+\.\d+)';") {
  throw "Could not find APP_VERSION in app.js"
}
$old = $Matches['v']
if ($old -eq $Version) { throw "app.js is already at v$Version" }
Write-Host "v$old  ->  v$Version" -ForegroundColor Cyan

$oldEsc = [regex]::Escape($old)
$idx    = Get-Content $indexHt -Raw -Encoding UTF8
$hits   = @{}

# ---- app.js ----------------------------------------------------------------
$app, $n = ($app -replace "const APP_VERSION='v$oldEsc';", "const APP_VERSION='v$Version';"), 1
$hits['APP_VERSION'] = ([regex]::Matches($app, "const APP_VERSION='v$([regex]::Escape($Version))';")).Count

$app = $app -replace "<div>Version: v$oldEsc</div>", "<div>Version: v$Version</div>"
$hits['App Info version'] = ([regex]::Matches($app, "<div>Version: v$([regex]::Escape($Version))</div>")).Count

# The release note is the single <div style="color:var(--text3);margin-top:4px">vX.Y.Z: ...</div>
# App Info intentionally shows only the current release, so this REPLACES rather
# than prepends. Note text is HTML - escape the few characters that matter.
$noteEsc = $Note -replace '&','&amp;' -replace '<','&lt;' -replace '>','&gt;'
$notePat = '<div style="color:var\(--text3\);margin-top:4px">v' + $oldEsc + ':.*?</div>'
$noteNew = '<div style="color:var(--text3);margin-top:4px">v' + $Version + ': ' + $noteEsc + '</div>'
if ($app -notmatch $notePat) { throw "Could not find the v$old release note in app.js" }
$app = [regex]::Replace($app, $notePat, { $noteNew }, 'Singleline')
$hits['Release note'] = 1

# ---- index.html ------------------------------------------------------------
$idx = $idx -replace "styles\.css\?v=$oldEsc", "styles.css?v=$Version"
$hits['styles.css ?v='] = ([regex]::Matches($idx, "styles\.css\?v=$([regex]::Escape($Version))")).Count

$idx = $idx -replace ">v$oldEsc<", ">v$Version<"
$hits['ver-lbl'] = ([regex]::Matches($idx, ">v$([regex]::Escape($Version))<")).Count

$idx = $idx -replace "app\.js\?v=$oldEsc", "app.js?v=$Version"
$hits['app.js ?v='] = ([regex]::Matches($idx, "app\.js\?v=$([regex]::Escape($Version))")).Count

# ---- report & write --------------------------------------------------------
$failed = $false
foreach ($k in 'APP_VERSION','App Info version','Release note','styles.css ?v=','ver-lbl','app.js ?v=') {
  $c = $hits[$k]
  if ($c -lt 1) { Write-Host ("  MISS  {0}" -f $k) -ForegroundColor Red; $failed = $true }
  else          { Write-Host ("  ok    {0}" -f $k) -ForegroundColor Green }
}
if ($failed) { throw "One or more version spots did not update - nothing written." }

# Encoding tripwire: the only characters that should change are the version
# digits, so the count of non-ASCII characters must be identical. If it is not,
# something re-encoded the file (this script once did exactly that) - refuse.
$naBefore = ((Get-Content $appJs -Raw -Encoding UTF8).ToCharArray() | Where-Object { [int]$_ -gt 127 }).Count
$naAfter  = ($app.ToCharArray() | Where-Object { [int]$_ -gt 127 }).Count
if ($naBefore -ne $naAfter) {
  throw "Encoding tripwire: non-ASCII count changed ($naBefore -> $naAfter). Refusing to write."
}
Write-Host ("  ok    encoding preserved ({0} non-ASCII chars)" -f $naAfter) -ForegroundColor Green

if ($WhatIf) { Write-Host "`n-WhatIf: no files written." -ForegroundColor Yellow; return }

# PS 5.1's -Encoding utf8 writes a BOM; these files have none and must keep none.
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($appJs,   $app, $utf8NoBom)
[System.IO.File]::WriteAllText($indexHt, $idx, $utf8NoBom)
Write-Host "`nAll 6 spots updated to v$Version." -ForegroundColor Green
Write-Host "Reminder: bump sw.js CACHE only if the precached STATIC list changed." -ForegroundColor DarkGray
