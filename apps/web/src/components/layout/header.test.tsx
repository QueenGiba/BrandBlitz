import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Header, avatarInitial } from "./header";

const mockUseSession = vi.fn();

vi.mock("next-auth/react", () => ({
  useSession: () => mockUseSession(),
  signOut: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("@/lib/api", () => ({
  createApiClient: () => ({
    get: vi.fn().mockResolvedValue({ data: { streak: null, notifications: [] } }),
  }),
}));

vi.mock("./notification-bell", () => ({
  NotificationBell: () => null,
}));

vi.mock("./theme-toggle", () => ({
  ThemeToggle: () => null,
}));

function sessionFor(name: string | null | undefined) {
  return {
    data: { user: { name, email: "player@example.com", image: null } },
    status: "authenticated",
  };
}

/** The avatar initials rendered in the desktop header and, once opened, the mobile menu. */
function renderedInitials(): string[] {
  fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
  return Array.from(document.querySelectorAll("div.rounded-full.bg-\\[var\\(--primary\\)\\]")).map(
    (el) => el.textContent ?? ""
  );
}

describe("avatarInitial", () => {
  it.each([
    ["", "U"],
    ["   ", "U"],
    [null, "U"],
    [undefined, "U"],
    ["ada", "A"],
    ["  bola", "B"],
  ])("returns %j -> %j", (name, initial) => {
    expect(avatarInitial(name)).toBe(initial);
  });
});

describe("Header avatar fallback", () => {
  beforeEach(() => {
    mockUseSession.mockReset();
  });

  it("shows 'U' in both the desktop and mobile avatars when the name is an empty string", () => {
    mockUseSession.mockReturnValue(sessionFor(""));
    render(<Header />);
    expect(renderedInitials()).toEqual(["U", "U"]);
  });

  it("shows 'U' in both avatars when the name is whitespace only", () => {
    mockUseSession.mockReturnValue(sessionFor("  "));
    render(<Header />);
    expect(renderedInitials()).toEqual(["U", "U"]);
  });

  it.each([undefined, null])("still shows 'U' when the name is %s", (name) => {
    mockUseSession.mockReturnValue(sessionFor(name));
    render(<Header />);
    expect(renderedInitials()).toEqual(["U", "U"]);
  });

  it("shows the uppercased first letter of a real name", () => {
    mockUseSession.mockReturnValue(sessionFor("zainab"));
    render(<Header />);
    expect(renderedInitials()).toEqual(["Z", "Z"]);
  });
});
