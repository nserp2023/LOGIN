$ErrorActionPreference = 'Stop'

$projectRef = 'kzxwjujjvnehhthazicc'
$outputPath = Join-Path $PSScriptRoot 'full supabase code.sql'
$tempPath = Join-Path ([IO.Path]::GetTempPath()) ('supabase-export-' + [guid]::NewGuid().ToString('N'))

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
    throw 'Node.js/npm is required. Install Node.js, then run this script again.'
}

Write-Host 'This exports the linked Supabase database schema only; it does not write to the remote database.'
Write-Host 'If needed, authenticate first with: npx --yes supabase@latest login'
Write-Host 'The link step may prompt for the database password.'

New-Item -ItemType Directory -Path $tempPath | Out-Null
Push-Location $tempPath
try {
    & npx --yes supabase@latest init
    if ($LASTEXITCODE -ne 0) {
        throw 'Temporary Supabase CLI initialization failed.'
    }

    & npx --yes supabase@latest link --project-ref $projectRef
    if ($LASTEXITCODE -ne 0) {
        throw 'Supabase project linking failed. No schema export was performed.'
    }

    & npx --yes supabase@latest db dump --linked --file $outputPath
    if ($LASTEXITCODE -ne 0) {
        throw 'Schema export failed. Check the CLI output and try again.'
    }
}
finally {
    Pop-Location
    Remove-Item -LiteralPath $tempPath -Recurse -Force
}

Write-Host "Schema export created at: $outputPath"
Write-Host 'This dump does not include table data, Auth users, Storage files, project secrets, or dashboard-level Auth settings.'