<#
.SYNOPSIS
  Installs/updates the "Workspace List" extension to the latest GitHub Release
  across every VS Code profile on this machine.

.DESCRIPTION
  This extension is distributed only via GitHub Releases (no Marketplace listing),
  so a profile that has never had it installed, or has an older version, must be
  updated manually per profile. This script:
    1. Fetches the latest release from GitHub and its .vsix asset.
    2. Enumerates every VS Code profile (reads profile names from globalStorage/storage.json;
       always includes the unnamed default profile).
    3. For each profile, checks the installed version of kodoro.workspace-list via
       `code --profile <name> --list-extensions --show-versions`.
    4. Skips profiles already on the latest version; downloads the VSIX once and
       installs/updates it in every profile that is missing it or out of date.
    5. Deletes the downloaded .vsix afterward.

.PARAMETER CodeCommand
  The VS Code CLI command to use. Defaults to "code". Use "code-insiders" for VS Code Insiders.
#>

param(
    [string]$CodeCommand = "code"
)

$ErrorActionPreference = "Stop"

$Repo = "mirekkl/vscext_workspace-list"
$ExtensionId = "kodoro.workspace-list"

function Get-InstalledVersion {
    param([string]$ProfileArgs)
    $listArgs = @()
    if ($ProfileArgs) { $listArgs += "--profile", $ProfileArgs }
    $listArgs += "--list-extensions", "--show-versions"
    $output = & $CodeCommand @listArgs 2>$null
    $line = $output | Where-Object { $_ -like "$ExtensionId@*" }
    if (-not $line) { return $null }
    return ($line -split "@")[1]
}

function Get-VsCodeProfileNames {
    # Always includes the unnamed default profile ($null = no --profile flag).
    $names = @($null)
    $storageJson = Join-Path $env:APPDATA "Code\User\globalStorage\storage.json"
    if (-not (Test-Path $storageJson)) { return $names }

    $data = Get-Content $storageJson -Raw | ConvertFrom-Json
    $profiles = $data.userDataProfiles
    if (-not $profiles) { return $names }

    foreach ($p in $profiles) {
        if ($p.name) { $names += $p.name }
    }
    return $names
}

Write-Host "Fetching latest release info for $Repo..."
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ "Accept" = "application/vnd.github+json" }
$latestVersion = $release.tag_name -replace '^v', ''
$asset = $release.assets | Where-Object { $_.name -like "*.vsix" } | Select-Object -First 1
if (-not $asset) {
    throw "Latest release $($release.tag_name) has no .vsix asset attached."
}
Write-Host "Latest release: $latestVersion ($($asset.name))"

$profileNames = Get-VsCodeProfileNames
Write-Host "Found $($profileNames.Count) profile(s): $(($profileNames | ForEach-Object { if ($_) { $_ } else { '(default)' } }) -join ', ')"

$targets = @()
foreach ($name in $profileNames) {
    $installed = Get-InstalledVersion -ProfileArgs $name
    $label = if ($name) { $name } else { "(default)" }
    if ($null -eq $installed) {
        Write-Host "  [$label] not installed -> will install $latestVersion"
        $targets += $name
    } elseif ($installed -ne $latestVersion) {
        Write-Host "  [$label] installed $installed -> will update to $latestVersion"
        $targets += $name
    } else {
        Write-Host "  [$label] already up to date ($installed)"
    }
}

if ($targets.Count -eq 0) {
    Write-Host "All profiles already up to date. Nothing to do."
    exit 0
}

$tmpDir = Join-Path $env:TEMP "workspace-list-sync-$(Get-Random)"
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
$vsixPath = Join-Path $tmpDir $asset.name

try {
    Write-Host "Downloading $($asset.name)..."
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $vsixPath

    foreach ($name in $targets) {
        $label = if ($name) { $name } else { "(default)" }
        Write-Host "Installing into profile [$label]..."
        $installArgs = @()
        if ($name) { $installArgs += "--profile", $name }
        $installArgs += "--install-extension", $vsixPath, "--force"
        & $CodeCommand @installArgs
    }
} finally {
    Write-Host "Cleaning up downloaded VSIX..."
    Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
}

Write-Host "Done. Updated $($targets.Count) profile(s) to $latestVersion."
