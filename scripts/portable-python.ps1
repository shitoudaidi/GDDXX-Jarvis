$ErrorActionPreference = 'Stop'

function Install-JarvisPortablePython {
  param([Parameter(Mandatory = $true)][string]$Root)

  $runtime = Join-Path $Root '.python'
  $python = Join-Path $runtime 'python.exe'
  if (-not (Test-Path -LiteralPath $python)) {
    $archive = Join-Path $env:TEMP 'jarvis-python-3.11.9-embed-amd64.zip'
    $url = 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip'
    curl.exe -L --fail --retry 3 --output $archive $url
    New-Item -ItemType Directory -Force -Path $runtime | Out-Null
    Expand-Archive -LiteralPath $archive -DestinationPath $runtime -Force
    Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue

    $pth = Join-Path $runtime 'python311._pth'
    $content = Get-Content -LiteralPath $pth
    $content = $content | ForEach-Object { if ($_ -eq '#import site') { 'import site' } else { $_ } }
    if ($content -notcontains 'Lib\site-packages') { $content += 'Lib\site-packages' }
    Set-Content -LiteralPath $pth -Value $content -Encoding ASCII
  }

  $pip = Join-Path $runtime 'Scripts\pip.exe'
  if (-not (Test-Path -LiteralPath $pip)) {
    $getPip = Join-Path $env:TEMP 'jarvis-get-pip.py'
    curl.exe -L --fail --retry 3 --output $getPip 'https://bootstrap.pypa.io/get-pip.py'
    & $python $getPip --disable-pip-version-check | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Failed to install pip into the portable Python runtime.' }
    Remove-Item -LiteralPath $getPip -Force -ErrorAction SilentlyContinue
  }

  return $python
}
