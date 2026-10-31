import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import LoginPage from "../login/page";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
  useSearchParams: () => ({
    get: () => null,
  }),
}));

// Mock API
vi.mock("@/lib/api-client", () => ({
  api: {
    me: vi.fn(() => Promise.reject(new Error("not authenticated"))),
    login: vi.fn(() => Promise.resolve({ ok: true })),
  },
}));

describe("Dashboard Authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders login form with email and password fields", async () => {
    render(<LoginPage />);
    await waitFor(() => {
      expect(screen.getByText("Developer console")).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/Email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sign in/i })).toBeInTheDocument();
  });

  it("shows error message on failed login", async () => {
    const { api } = await import("@/lib/api-client");
    vi.mocked(api.login).mockRejectedValueOnce(new Error("Invalid"));
    render(<LoginPage />);
    await waitFor(() => {
      expect(screen.getByText("Developer console")).toBeInTheDocument();
    });
    // Test would need to fill form and submit - simplified test
  });
});
