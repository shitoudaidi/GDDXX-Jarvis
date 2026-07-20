$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root '.venv'
$python = Join-Path $venv 'Scripts\python.exe'
$modelDir = Join-Path $root 'models\whisper'
$modelFile = Join-Path $modelDir 'tiny.pt'

if (-not (Test-Path -LiteralPath $python)) {
  if (Get-Command uv -ErrorAction SilentlyContinue) {
    uv venv --python 3.11 $venv
  } else {
    py -3.11 -m venv $venv
  }
}
if (-not (Test-Path -LiteralPath $python)) { throw 'Could not create the project Python 3.11 environment.' }

if (Get-Command uv -ErrorAction SilentlyContinue) {
  uv pip install --python $python 'openai-whisper>=20240930' 'websockets>=12,<16'
} else {
  & $python -m pip install --disable-pip-version-check 'openai-whisper>=20240930' 'websockets>=12,<16'
}
if ($LASTEXITCODE -ne 0) { throw 'Failed to install local ASR dependencies.' }

New-Item -ItemType Directory -Force -Path $modelDir | Out-Null
if (-not (Test-Path -LiteralPath $modelFile)) {
  $env:JARVIS_WHISPER_MODEL_DIR = $modelDir
  & $python -c "import sys; sys.path.insert(0, r'$root\src\core\voice'); import whisper; whisper.load_model('tiny', download_root=r'$modelDir'); print('Whisper tiny ready')"
  if ($LASTEXITCODE -ne 0) { throw 'Failed to download the Whisper tiny model.' }
}

Write-Host "Local ASR ready: $modelFile"
