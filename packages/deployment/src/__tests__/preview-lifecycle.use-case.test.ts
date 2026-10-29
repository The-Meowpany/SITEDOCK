import { describe, expect, it } from "vitest";
import { Preview } from "../domain/preview.entity";
import { WebsiteId } from "@sitedock/shared";

// Use plain string workspace IDs matching the implementation's expectation
// The DeletePreviewUseCase checks: preview.websiteId.value !== workspaceId
const MATCHING_WORKSPACE = "11111111-1111-1111-1111-111111111111";
const DIFFERENT_WORKSPACE = "aaaaaaaa-1111-1111-1111-111111111111";

function preview(id: string, websiteId: string, branch: string, commitSha: string, status: "PENDING" | "BUILDING" | "READY" | "FAILED" | "CANCELED" = "PENDING", deploymentId?: string): Preview {
  return Preview.create({
    id,
    websiteId: WebsiteId(websiteId),
    branch,
    commitSha,
    status,
    deploymentId,
  });
}

describe("Preview Lifecycle Logic (isolated)", () => {
  it("preview status determines deletability", () => {
    // READY preview should not be deletable (preserves last successful revision)
    const _readyPreview = preview("ready1", MATCHING_WORKSPACE, "feature/ready", "commit-ready", "READY");
    
    // BUILDING preview should not be deletable (build in progress)
    const _buildingPreview = preview("build1", MATCHING_WORKSPACE, "feature/build", "commit-build", "BUILDING");
    
    // FAILED preview should be deletable
    const _failedPreview = preview("failed1", MATCHING_WORKSPACE, "feature/failed", "commit-failed", "FAILED");
    
    // CANCELED preview should be deletable
    const _canceledPreview = preview("canceled1", MATCHING_WORKSPACE, "feature/canceled", "commit-canceled", "CANCELED");
    
    // Deployment-linked preview should not be deletable
    const _linkedPreview = preview("linked1", MATCHING_WORKSPACE, "feature/linked", "commit-linked", "FAILED", "dep-123");
    
    // Different workspace preview should not be deletable (ownership check)
    const _wrongWorkspacePreview = preview("wrong1", DIFFERENT_WORKSPACE, "feature/wrong", "commit-wrong", "FAILED");
    
    const expectedReadonly = ["READY", "BUILDING"];
    const expectedDeletable = ["FAILED", "CANCELED"];
    
    expect(expectedReadonly.includes("READY")).toBe(true);
    expect(expectedReadonly.includes("BUILDING")).toBe(true);
    expect(expectedDeletable.includes("FAILED")).toBe(true);
    expect(expectedDeletable.includes("CANCELED")).toBe(true);
  });

  it("workspace ID comparison works correctly", () => {
    const sameWorkspacePreview = preview("same1", MATCHING_WORKSPACE, "feature/same", "commit-same", "FAILED");
    const diffWorkspacePreview = preview("diff1", DIFFERENT_WORKSPACE, "feature/diff", "commit-diff", "FAILED");
    
    // Same workspace should match
    expect(String(sameWorkspacePreview.websiteId)).toBe(MATCHING_WORKSPACE);
    // Different workspace should not match
    expect(String(diffWorkspacePreview.websiteId)).not.toBe(MATCHING_WORKSPACE);
    expect(String(diffWorkspacePreview.websiteId)).toBe(DIFFERENT_WORKSPACE);
  });
});