# Start the full SiteDock local stack with Podman (rootless, WSL2).
# Requires: WSL2 with podman + podman-compose installed.
param(
    [switch]$Build,
    [switch]$Down
)
$repo = (Resolve-Path "$PSScriptRoot\..").Path
$wslRepo = "/mnt/" + $repo.Substring(0,1).ToLower() + $repo.Substring(2).Replace("\","/")
if ($Down) {
    wsl --distribution FedoraLinux-44 --exec bash -c "cd $wslRepo && podman-compose down"
    exit $LASTEXITCODE
}
$args = "up -d"
if ($Build) { $args += " --build" }
wsl --distribution FedoraLinux-44 --exec bash -c "cd $wslRepo && podman-compose $args"
exit $LASTEXITCODE
