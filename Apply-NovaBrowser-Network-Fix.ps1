param(
    [Parameter(Mandatory = $false)]
    [string]$ProjectRoot = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$sourceRoot = $PSScriptRoot

if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'package.json') -PathType Leaf)) {
    throw "ProjectRoot does not look like the Nova Browser project (package.json not found): $ProjectRoot"
}

$relativeFiles = @(
    '.env.example',
    'src/config.js',
    'src/search.js',
    'src/core/rank.js',
    'src/providers/http.js',
    'src/providers/searxng.js',
    'src/providers/index.js',
    'tests/provider-network-fixes.test.js'
)

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Join-Path $ProjectRoot ".nova-browser-patch-backup-$timestamp"
$copied = [System.Collections.Generic.List[string]]::new()

foreach ($relative in $relativeFiles) {
    $source = Join-Path $sourceRoot $relative
    $destination = Join-Path $ProjectRoot $relative

    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Patch file missing: $source"
    }

    if (Test-Path -LiteralPath $destination -PathType Leaf) {
        $backup = Join-Path $backupRoot $relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $backup) -Force | Out-Null
        Copy-Item -LiteralPath $destination -Destination $backup -Force
    }

    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
    $copied.Add($relative)
}

Write-Host ''
Write-Host 'Nova Browser network patch files copied successfully.' -ForegroundColor Green
Write-Host "Project: $ProjectRoot"
if (Test-Path -LiteralPath $backupRoot) {
    Write-Host "Backups of replaced files: $backupRoot"
}
Write-Host 'Files copied:'
$copied | ForEach-Object { Write-Host "  - $_" }
Write-Host ''
Write-Host 'Verification: src/providers/searxng.js should export createSearxngProvider.'
Write-Host 'Next run: node --test tests/provider-network-fixes.test.js tests/search-providers.test.js tests/searxng.test.js tests/config.test.js'
