#Requires -Version 7
param(
    [Parameter(Mandatory)] [string] $Repo,
    [Parameter(Mandatory)] [string] $Commit
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$build = Join-Path $PSScriptRoot 'build'
$out = Join-Path $build $Commit
$zip = Join-Path $build "$Commit.zip"

if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force $out | Out-Null
Invoke-WebRequest "https://codeload.github.com/$Repo/tar.gz/$Commit" -OutFile (Join-Path $out 'motioneye.tar.gz')
Copy-Item (Join-Path $PSScriptRoot 'Dockerfile') $out
Copy-Item -Recurse (Join-Path $PSScriptRoot 'preview') $out

if (Test-Path $zip) { Remove-Item $zip }
$archive = [System.IO.Compression.ZipFile]::Open($zip, 'Create')
try {
    foreach ($file in Get-ChildItem -Recurse -File $out) {
        $entry = [System.IO.Path]::GetRelativePath($out, $file.FullName).Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $entry) | Out-Null
    }
} finally {
    $archive.Dispose()
}

Write-Host "OK: build context $out"
Write-Host "OK: code artifact $zip"
