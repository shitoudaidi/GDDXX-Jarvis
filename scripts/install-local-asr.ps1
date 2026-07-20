$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'portable-python.ps1')
$python = Install-JarvisPortablePython -Root $root
$modelDir = Join-Path $root 'models\whisper'
$modelFile = Join-Path $modelDir 'tiny.pt'

& $python -m pip install --disable-pip-version-check 'openai-whisper>=20240930' 'websockets>=12,<16'
if ($LASTEXITCODE -ne 0) { throw 'Failed to install local ASR dependencies.' }

New-Item -ItemType Directory -Force -Path $modelDir | Out-Null
if (-not (Test-Path -LiteralPath $modelFile)) {
  $env:JARVIS_WHISPER_MODEL_DIR = $modelDir
  & $python -c "import sys; sys.path.insert(0, r'$root\src\core\voice'); import whisper; whisper.load_model('tiny', download_root=r'$modelDir'); print('Whisper tiny ready')"
  if ($LASTEXITCODE -ne 0) { throw 'Failed to download the Whisper tiny model.' }
}

Write-Host "Local ASR ready: $modelFile"
