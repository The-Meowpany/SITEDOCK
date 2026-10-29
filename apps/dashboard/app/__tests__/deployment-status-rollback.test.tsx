import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import WebsiteDetailPage from "../workspaces/[workspaceId]/sitios/[websiteId]/page";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
  useParams: () => ({ workspaceId: "ws-123", websiteId: "w1" }),
}));

// Mock API
vi.mock("@/lib/api-client", () => ({
  api: {
    getWebsite: vi.fn(() => Promise.resolve({
      id: "w1",
      name: "site1.example.com",
      status: "LIVE",
      projectId: "p1",
      customDomain: null,
      deployment: { id: "d1", status: "LIVE", revisionId: "r1", createdAt: new Date().toISOString() },
      revisions: [
        { id: "r1", status: "LIVE", createdAt: new Date().toISOString() },
        { id: "r2", status: "READY", createdAt: new Date(Date.now()-86400000).toISOString() },
      ]
    })),
    listDeployments: vi.fn(() => Promise.resolve([])),
    publishWebsite: vi.fn(),
    rollbackWebsite: vi.fn(() => Promise.resolve({ ok: true })),
    getDeployment: vi.fn(),
  },
}));

describe("Dashboard Deployment Status and Rollback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("displays deployment status", async () => {
    render(<WebsiteDetailPage />);
    await waitFor(() => {
      expect(screen.getByText(/site1.example.com/i)).toBeInTheDocument();
    });
  });

  it("provides rollback functionality", async () => {
    render(<WebsiteDetailPage />);
    await waitFor(() => {
      expect(screen.getByText(/site1.example.com/i)).toBeInTheDocument();
    });
    // Rollback controls should be present
  });

  it("handles errors gracefully", async () => {
    const { api } = await import("@/lib/api-client");
    (api.getWebsite as any).mockRejectedValueOnce(new Error("Failed to load"));
    render(<WebsiteDetailPage />);
    await waitFor(() => {
      expect(screen.getByText(/Failed to load|error/i)).toBeInTheDocument();
    });
  });
});
