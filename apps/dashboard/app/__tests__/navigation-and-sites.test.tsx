import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import SitesPage from "../workspaces/[workspaceId]/sitios/page";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
  useParams: () => ({ workspaceId: "ws-123" }),
}));

// Mock API
vi.mock("@/lib/api-client", () => ({
  api: {
    listWebsites: vi.fn(() => Promise.resolve([
      { id: "w1", name: "site1.example.com", status: "LIVE", projectId: "p1" }
    ])),
    listProjects: vi.fn(() => Promise.resolve([
      { id: "p1", name: "Project 1" }
    ])),
    createProject: vi.fn(),
    createWebsite: vi.fn(),
  },
}));

describe("Dashboard Navigation and Website Listing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders sites list page with create form", async () => {
    render(<SitesPage />);
    await waitFor(() => {
      expect(screen.getByText(/Crear sitio/i)).toBeInTheDocument();
    });
  });

  it("displays existing websites", async () => {
    render(<SitesPage />);
    await waitFor(() => {
      expect(screen.getByText("site1.example.com")).toBeInTheDocument();
    });
  });
});
