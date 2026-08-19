$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
  npm install --cache .npm-cache --registry https://registry.npmjs.org
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
  Pop-Location
}
