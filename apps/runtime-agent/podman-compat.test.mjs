import test from "node:test";
import assert from "node:assert/strict";
import { buildPullArgsForVersion, isUnsupportedBuildNoNewPrivileges } from "./podman-compat.mjs";

test("Podman 4+ uses the explicit missing pull policy", () => {
  assert.deepEqual(buildPullArgsForVersion("podman version 4.9.3"), ["--pull=missing"]);
  assert.deepEqual(buildPullArgsForVersion("podman version 5.0.0"), ["--pull=missing"]);
});

test("Podman 3.x gets no --pull flag (boolean flag there)", () => {
  assert.deepEqual(buildPullArgsForVersion("podman version 3.4.4"), []);
});

test("unknown version output falls back to the portable form", () => {
  assert.deepEqual(buildPullArgsForVersion(""), []);
  assert.deepEqual(buildPullArgsForVersion(undefined), []);
});

test("detects buildah rejecting build-time no-new-privileges", () => {
  assert.equal(isUnsupportedBuildNoNewPrivileges("Error: no-new-privileges is not supported"), true);
  assert.equal(isUnsupportedBuildNoNewPrivileges("Error: base image not found"), false);
  assert.equal(isUnsupportedBuildNoNewPrivileges(undefined), false);
});
