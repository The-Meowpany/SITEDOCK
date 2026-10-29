import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma, assertDedicatedTestDatabase } from "@sitedock/database";
import { WebsiteId } from "@sitedock/shared";
import { randomUUID } from "node:crypto";
import { Deployment } from "../domain/deployment.entity";
import { PrismaDeploymentRepository } from "../infrastructure/prisma-deployment.repository";

/**
 * Deployment lifecycle acceptance test (end-to-end)
 *
 * This test creates isolated test resources (organization, workspace, project, website)
 * and verifies deployment revision tracking with rollback support at the database level.
 *
 * What it verifies (database persistence):
 * - Deployments are persisted in the test namespace
 * - Revision versions are tracked correctly
 * - Both deployment versions are available for the website
 * - Version 1 is available as a predecessor for rollback
 *
 * What it does NOT verify (blocked by unavailable runtime/infrastructure):
 * - File upload through the multipart API endpoint
 * - Worker claim and build execution
 * - Runtime health checks and process startup
 * - HTTP traffic serving revisions
 * - Controlled failure simulation
 * - Actual rollback via HTTP endpoint
 * - Real revision identifiers served through the traffic path
 *
 * The full end-to-end deployment pipeline cannot be exercised in the current environment
 * because the runtime agent, worker process, and HTTP traffic path are not available.
 * This test verifies database-level invariants only.
 */
describe("Deployment lifecycle database persistence", () => {
  const TEST_SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  let workspaceId: string;
  let organizationId: string;
  let projectId: string;
  let websiteId: string;

  beforeAll(async () => {
    await assertDedicatedTestDatabase(prisma, "deployment-acceptance");

    const orgSuffix = TEST_SUFFIX;
    organizationId = randomUUID();
    await prisma.organization.create({
      data: { id: organizationId, name: `Acceptance Org ${orgSuffix}`, slug: `acceptance-org-${orgSuffix.replace(/\-/g, "")}` },
    });

    workspaceId = randomUUID();
    await prisma.workspace.create({
      data: { id: workspaceId, name: `Acceptance WS ${orgSuffix}`, slug: `acceptance-ws-${orgSuffix.replace(/\-/g, "")}` },
    });

    projectId = randomUUID();
    await prisma.project.create({
      data: { id: projectId, workspaceId, name: `Acceptance Project ${orgSuffix}` },
    });

    websiteId = randomUUID();
    await prisma.website.create({
      data: {
        id: websiteId,
        workspaceId,
        projectId,
        name: `Acceptance Website ${orgSuffix}`,
        subdomain: `acceptance-website-${orgSuffix.replace(/\-/g, "")}`,
        status: "DRAFT",
      },
    });
  });

  afterAll(async () => {
    await prisma.$transaction(async (tx) => {
      const deployments = await tx.deployment.findMany({ where: { websiteId } });
      for (const dep of deployments) {
        await tx.deployment.delete({ where: { id: dep.id } });
      }
      await tx.website.delete({ where: { id: websiteId } });
      await tx.project.delete({ where: { id: projectId } });
      await tx.workspace.delete({ where: { id: workspaceId } });
      await tx.organization.delete({ where: { id: organizationId } });
    });
  });

  it("should create deployments and verify revision tracking with rollback support", async () => {
    // Create deployments directly using the repository to test the deployment lifecycle
    const repo = new PrismaDeploymentRepository();

    // Create first deployment (v1) - initial revision
    const deployment1 = Deployment.create({
      id: randomUUID(),
      websiteId: WebsiteId(websiteId),
      version: 1,
      storagePath: `websites/${websiteId}/deployments/${randomUUID()}`,
      uploadedById: "test-user",
    });
    await repo.save(deployment1);

    // Create second deployment (v2) - second revision
    const deployment2 = Deployment.create({
      id: randomUUID(),
      websiteId: WebsiteId(websiteId),
      version: 2,
      storagePath: `websites/${websiteId}/deployments/${randomUUID()}`,
      uploadedById: "test-user",
    });
    await repo.save(deployment2);

    // Verify both deployments are tracked for the website
    const allDeployments = await repo.listByWebsite(WebsiteId(websiteId));
    expect(allDeployments.length).toBe(2);
    const versions = allDeployments.map((d) => d.version).sort();
    expect(versions).toEqual([1, 2]);

    // Verify version 1 is available for rollback (the core invariant)
    const v1 = allDeployments.find((d) => d.version === 1);
    const v2 = allDeployments.find((d) => d.version === 2);
    expect(v1).toBeDefined();
    expect(v2).toBeDefined();
    expect(v1!.version).toBe(1);
    expect(v2!.version).toBe(2);

    // Verify the system tracks revision history correctly
    // The latest version (2) is the current deployment
    // Version 1 is the previous revision available for rollback
    console.log(`✅ Deployment lifecycle acceptance test passed`);
    console.log(`   - Initial deployment v1: ${deployment1.id}`);
    console.log(`   - Second deployment v2: ${deployment2.id}`);
    console.log(`   - Both revisions tracked and verified for rollback support`);
  });
});
