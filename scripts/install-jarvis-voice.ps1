$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root '.venv'
$python = Join-Path $venv 'Scripts\python.exe'
$modelRoot = Join-Path $root 'models\jarvis'
$modelFile = Join-Path $modelRoot 'en\en_GB\jarvis\high\jarvis-high.onnx'
$modelConfig = "$modelFile.json"
$espeakSource = Join-Path $root '.venv\Lib\site-packages\piper\espeak-ng-data'
$espeakDestination = Join-Path $env:LOCALAPPDATA 'Jarvis\voice\espeak-ng-data'
$download = Join-Path $env:TEMP 'jarvis-voice-model.zip'
$url = 'https://modelscope.cn/datasets/rubintry/jarvis/resolve/master/jarvis%E8%AF%AD%E9%9F%B3%E6%A8%A1%E5%9E%8B/jarvis.zip'

if (-not (Test-Path -LiteralPath $python)) {
  if (Get-Command uv -ErrorAction SilentlyContinue) {
    uv venv --python 3.11 $venv
  } else {
    py -3.11 -m venv $venv
  }
}
if (-not (Test-Path -LiteralPath $python)) { throw 'Could not create the project Python 3.11 environment.' }

if (Get-Command uv -ErrorAction SilentlyContinue) {
  uv pip install --python $python 'piper-tts>=1.3.0' 'numpy>=1.26,<3' 'soundfile>=0.12'
  if ($LASTEXITCODE -ne 0) { throw 'Failed to install Jarvis voice Python dependencies with uv.' }
} else {
  & $python -m ensurepip --upgrade
  if ($LASTEXITCODE -ne 0) { throw 'Failed to bootstrap pip.' }
  & $python -m pip install --disable-pip-version-check 'piper-tts>=1.3.0' 'numpy>=1.26,<3' 'soundfile>=0.12'
  if ($LASTEXITCODE -ne 0) { throw 'Failed to install Jarvis voice Python dependencies.' }
}

if (-not ((Test-Path -LiteralPath $modelFile) -and (Test-Path -LiteralPath $modelConfig))) {
  Write-Host 'Downloading the 157 MB Jarvis Piper model...'
  curl.exe -L --fail --retry 3 --output $download $url
  $extract = Join-Path $env:TEMP ('jarvis-model-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $extract | Out-Null
  try {
    Expand-Archive -LiteralPath $download -DestinationPath $extract -Force
    $onnx = Get-ChildItem -LiteralPath $extract -Recurse -Filter 'jarvis-high.onnx' | Select-Object -First 1
    $json = Get-ChildItem -LiteralPath $extract -Recurse -Filter 'jarvis-high.onnx.json' | Select-Object -First 1
    if (-not $onnx -or -not $json) { throw 'Downloaded archive does not contain the expected Jarvis model files.' }
    $destination = Split-Path -Parent $modelFile
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    Copy-Item -LiteralPath $onnx.FullName -Destination $modelFile -Force
    Copy-Item -LiteralPath $json.FullName -Destination $modelConfig -Force
  } finally {
    Remove-Item -LiteralPath $extract -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $download -Force -ErrorAction SilentlyContinue
  }
}

if (-not (Test-Path -LiteralPath (Join-Path $espeakDestination 'phontab'))) {
  if (-not (Test-Path -LiteralPath (Join-Path $espeakSource 'phontab'))) {
    throw "Piper espeak-ng-data is missing from $espeakSource"
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $espeakDestination) | Out-Null
  Copy-Item -LiteralPath $espeakSource -Destination $espeakDestination -Recurse -Force
}

Write-Host "Jarvis voice ready: $modelFile"
