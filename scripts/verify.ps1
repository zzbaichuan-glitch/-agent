$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
  npm run typecheck
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  npm run test
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  npm run build
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
  Pop-Location
}
