/**
 * `podman build --pull=<policy>` only exists from Podman 4. Podman 3.x (the
 * Ubuntu 22.04 / Debian 12 packages) parses --pull as a boolean and fails with
 * "invalid argument \"missing\""; its default already pulls a base image only
 * when it is missing, so no flag is passed there.
 */
export function buildPullArgsForVersion(versionOutput) {
  const match = /(\d+)\.\d+/.exec(versionOutput ?? "");
  const major = match ? Number(match[1]) : 0;
  return major >= 4 ? ["--pull=missing"] : [];
}

/** Build-time no-new-privileges is rejected by buildah ("... is not supported"). */
export function isUnsupportedBuildNoNewPrivileges(stderr) {
  return /no-new-privileges is not supported/i.test(stderr ?? "");
}
