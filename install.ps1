# Install the latest Executioner release on Windows.
#
#   irm https://raw.githubusercontent.com/dbx0/executioner/main/install.ps1 | iex
#
# Downloads the setup from the latest GitHub release, checks it against
# SHA256SUMS.txt and runs it silently. It installs for the current user under
# %LOCALAPPDATA%\Programs\Executioner, with Start menu and desktop shortcuts.
#
# Environment:
#   $env:EXECUTIONER_VERSION = 'v0.0.2'   install that tag instead of the latest
#   $env:EXECUTIONER_UNINSTALL = '1'      remove Executioner instead

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Repo = 'dbx0/executioner'
$App = 'Executioner'

function Write-Step($Message) { Write-Host "==> $Message" -ForegroundColor Red }

if ($env:EXECUTIONER_UNINSTALL -eq '1') {
  $uninstaller = Join-Path $env:LOCALAPPDATA "Programs\$App\Uninstall $App.exe"
  if (-not (Test-Path $uninstaller)) { throw "$App is not installed for this user." }
  Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait
  Write-Step "$App removed. Engagement folders and settings were left in place."
  return
}

if (-not [Environment]::Is64BitOperatingSystem) { throw 'Executioner ships for 64-bit Windows only.' }

[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# The latest release's tag, read off the redirect GitHub serves for
# /releases/latest (no API call, so no rate limit).
$tag = $env:EXECUTIONER_VERSION
if (-not $tag) {
  $request = [Net.WebRequest]::Create("https://github.com/$Repo/releases/latest")
  $response = $request.GetResponse()
  $url = $response.ResponseUri.AbsoluteUri
  $response.Close()
  if ($url -notmatch '/releases/tag/([^/]+)$') { throw "No published release found for $Repo." }
  $tag = $Matches[1]
}
$version = $tag.TrimStart('v')

$asset = "$App-$version-win-x64-setup.exe"
$base = "https://github.com/$Repo/releases/download/$tag"
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("executioner-" + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null

try {
  Write-Step "Downloading $App $tag ($asset)"
  $setup = Join-Path $tmp $asset
  $sums = Join-Path $tmp 'SHA256SUMS.txt'
  Invoke-WebRequest -UseBasicParsing -Uri "$base/$asset" -OutFile $setup
  Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS.txt" -OutFile $sums

  $line = Get-Content $sums | Where-Object { ($_ -split '\s+')[1] -in @($asset, "*$asset") } | Select-Object -First 1
  if (-not $line) { throw "$asset is not listed in SHA256SUMS.txt." }
  $expected = ($line -split '\s+')[0].ToLower()
  $actual = (Get-FileHash -Algorithm SHA256 -Path $setup).Hash.ToLower()
  if ($actual -ne $expected) { throw "Checksum mismatch for $asset." }
  Write-Step 'Checksum verified'

  Write-Step 'Installing'
  $process = Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "The installer exited with code $($process.ExitCode)." }

  Write-Step "$App $tag is ready. Open it from the Start menu."
}
finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
