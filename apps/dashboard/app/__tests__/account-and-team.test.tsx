import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { canManage, assignableRoles } from "@/lib/team-roles";
import AccountPage from "../account/page";
import TeamPage from "../workspaces/[workspaceId]/equipo/page";

const replace = vi.fn();
// Must be referentially stable, like Next's real router; a fresh object per render would
// re-run every effect that depends on it and loop forever.
const router = { push: vi.fn(), replace };

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useParams: () => ({ workspaceId: "ws-1" }),
  usePathname: () => "/workspaces/ws-1/equipo",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock("@/components/AppHeader", () => ({ AppHeader: () => <div data-testid="header" /> }));

vi.mock("@/lib/api-client", () => ({
  api: {
    me: vi.fn(),
    listSessions: vi.fn(),
    changePassword: vi.fn(),
    revokeSession: vi.fn(),
    deleteAccount: vi.fn(),
    listWorkspaces: vi.fn(),
    listMembers: vi.fn(),
    changeMemberRole: vi.fn(),
    removeMember: vi.fn(),
    transferOwnership: vi.fn(),
    deleteWorkspace: vi.fn(),
    renameWorkspace: vi.fn(),
  },
}));

import { api } from "@/lib/api-client";
const mocked = vi.mocked(api, true);

describe("team role matrix (UI mirror of the server policy)", () => {
  it("owner manages all but owner; admin only developer/client; others nobody", () => {
    expect(canManage("OWNER", "ADMIN")).toBe(true);
    expect(canManage("OWNER", "OWNER")).toBe(false);
    expect(canManage("ADMIN", "ADMIN")).toBe(false);
    expect(canManage("ADMIN", "CLIENT")).toBe(true);
    expect(canManage("DEVELOPER", "CLIENT")).toBe(false);
    expect(canManage(null, "CLIENT")).toBe(false);
    expect(assignableRoles("ADMIN")).toEqual(["DEVELOPER", "CLIENT"]);
    expect(assignableRoles("CLIENT")).toEqual([]);
  });
});

describe("AccountPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.me.mockResolvedValue({ id: "u1", email: "ana@example.com", fullName: "Ana" });
    mocked.listSessions.mockResolvedValue([
      { id: "s1", userAgent: "Firefox", ipAddress: "1.1.1.1", createdAt: new Date().toISOString(), expiresAt: new Date().toISOString(), current: true },
      { id: "s2", userAgent: "Chrome", ipAddress: "2.2.2.2", createdAt: new Date().toISOString(), expiresAt: new Date().toISOString(), current: false },
    ]);
  });

  it("only offers to close OTHER sessions", async () => {
    render(<AccountPage />);
    await screen.findByText("Firefox");
    expect(screen.getAllByRole("button", { name: "Sign out" })).toHaveLength(1);
    expect(screen.getByText("This session")).toBeInTheDocument();
  });

  it("changes the password and reports revoked sessions", async () => {
    mocked.changePassword.mockResolvedValue({ revokedSessions: 2 });
    render(<AccountPage />);
    await screen.findByText("Firefox");
    const panel = screen.getByRole("region", { name: "Change password" });
    fireEvent.change(panel.querySelectorAll("input")[0]!, { target: { value: "old-password" } });
    fireEvent.change(panel.querySelectorAll("input")[1]!, { target: { value: "new-password-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    await waitFor(() => expect(mocked.changePassword).toHaveBeenCalledWith("old-password", "new-password-1"));
    expect(await screen.findByText(/2 session\(s\) on other devices were signed out/)).toBeInTheDocument();
  });

  it("keeps account deletion disabled until the confirmation word is typed", async () => {
    render(<AccountPage />);
    await screen.findByText("Firefox");
    const button = screen.getByRole("button", { name: "Delete my account" });
    expect(button).toBeDisabled();
    const panel = screen.getByRole("region", { name: "Delete account" });
    fireEvent.change(panel.querySelectorAll("input")[0]!, { target: { value: "pw" } });
    fireEvent.change(panel.querySelectorAll("input")[1]!, { target: { value: "DELETE" } });
    expect(button).toBeEnabled();
  });

  it("shows the server's message when the password is wrong", async () => {
    const { ApiError } = await import("@/lib/api-error");
    mocked.changePassword.mockRejectedValue(new ApiError(400, "INVALID_PASSWORD", "Current password is incorrect"));
    render(<AccountPage />);
    await screen.findByText("Firefox");
    const panel = screen.getByRole("region", { name: "Change password" });
    fireEvent.change(panel.querySelectorAll("input")[0]!, { target: { value: "bad" } });
    fireEvent.change(panel.querySelectorAll("input")[1]!, { target: { value: "new-password-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Current password is incorrect");
    expect(replace).not.toHaveBeenCalled(); // a wrong password must not look like an expired session
  });
});

describe("TeamPage", () => {
  const members = [
    { userId: "u1", fullName: "Ana", email: "ana@example.com", role: "OWNER" as const, joinedAt: null },
    { userId: "u2", fullName: "Beto", email: "beto@example.com", role: "ADMIN" as const, joinedAt: null },
    { userId: "u3", fullName: "Caro", email: "caro@example.com", role: "DEVELOPER" as const, joinedAt: null },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mocked.me.mockResolvedValue({ id: "u1", email: "ana@example.com", fullName: "Ana" });
    mocked.listMembers.mockResolvedValue(members);
  });

  it("owner can manage others but never sees controls on their own row", async () => {
    mocked.listWorkspaces.mockResolvedValue([{ id: "ws-1", name: "Studio", slug: "studio", role: "OWNER" }]);
    render(<TeamPage />);
    await screen.findByText("Beto");
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Leave" })).toBeNull();
    expect(screen.getByRole("region", { name: "Transfer ownership" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Delete workspace" })).toBeInTheDocument();
  });

  it("admin cannot touch another admin or see owner-only sections", async () => {
    mocked.me.mockResolvedValue({ id: "u2", email: "beto@example.com", fullName: "Beto" });
    mocked.listWorkspaces.mockResolvedValue([{ id: "ws-1", name: "Studio", slug: "studio", role: "ADMIN" }]);
    render(<TeamPage />);
    await screen.findByText("Caro");
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(1); // only the developer
    expect(screen.getByRole("button", { name: "Leave" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Transfer ownership" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Delete workspace" })).toBeNull();
  });

  it("clients never request the roster", async () => {
    mocked.listWorkspaces.mockResolvedValue([{ id: "ws-1", name: "Studio", slug: "studio", role: "CLIENT" }]);
    render(<TeamPage />);
    await screen.findByText(/cannot view the team roster/);
    expect(mocked.listMembers).not.toHaveBeenCalled();
  });
});
