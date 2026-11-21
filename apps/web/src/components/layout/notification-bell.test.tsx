import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { NotificationBell, POLL_FAILURE_THRESHOLD } from "./notification-bell";

const mockPatch = vi.fn();
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockDelete = vi.fn();
const mockIsPushSupported = vi.fn(() => true);
const mockGetExistingPushSubscription = vi.fn();
const mockSubscribeToPush = vi.fn();
const mockUnsubscribeFromPush = vi.fn();

vi.mock("@/lib/api", () => ({
  createApiClient: () => ({
    get: mockGet,
    patch: mockPatch,
    post: mockPost,
    delete: mockDelete,
  }),
}));

vi.mock("@/lib/push", () => ({
  isPushSupported: () => mockIsPushSupported(),
  getExistingPushSubscription: () => mockGetExistingPushSubscription(),
  subscribeToPush: (key: string) => mockSubscribeToPush(key),
  unsubscribeFromPush: () => mockUnsubscribeFromPush(),
}));

describe("NotificationBell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPushSupported.mockReturnValue(true);
    mockGetExistingPushSubscription.mockResolvedValue(null);
    mockGet.mockResolvedValue({
      data: {
        notifications: [
          {
            id: "n1",
            type: "payout_received",
            payload: { amount_usdc: "10.0" },
            created_at: new Date().toISOString(),
            read_at: null,
          },
        ],
      },
    });
  });

  it("shows success confirmation when Mark all read completes", async () => {
    mockPatch.mockResolvedValueOnce({});
    render(<NotificationBell apiToken="test-token" />);

    const bell = await screen.findByRole("button", { name: /Notifications/i });
    fireEvent.click(bell);

    const markAllBtn = await screen.findByRole("button", { name: /Mark all read/i });
    fireEvent.click(markAllBtn);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("All notifications marked as read");
    });
  });

  it("shows error confirmation when Mark all read fails", async () => {
    mockPatch.mockRejectedValueOnce(new Error("API failure"));
    render(<NotificationBell apiToken="test-token" />);

    const bell = await screen.findByRole("button", { name: /Notifications/i });
    fireEvent.click(bell);

    const markAllBtn = await screen.findByRole("button", { name: /Mark all read/i });
    fireEvent.click(markAllBtn);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Failed to mark notifications as read");
    });
  });

  it("subscribes to push from the notification drawer", async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === "/users/me/push/config") {
        return Promise.resolve({ data: { configured: true, public_key: "vapid-key" } });
      }
      if (url === "/users/me/push/subscriptions") {
        return Promise.resolve({ data: { enabled: false, subscriptions: [] } });
      }
      return Promise.resolve({ data: { notifications: [] } });
    });
    mockSubscribeToPush.mockResolvedValue({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      keys: { p256dh: "p256dh-key", auth: "auth-key" },
    });
    mockPost.mockResolvedValue({});
    mockPatch.mockResolvedValue({});

    render(<NotificationBell apiToken="test-token" />);
    fireEvent.click(await screen.findByRole("button", { name: /Notifications/i }));

    const toggle = await screen.findByRole("switch", { name: /Push notifications/i });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockSubscribeToPush).toHaveBeenCalledWith("vapid-key");
    });
    expect(mockPost).toHaveBeenCalledWith(
      "/users/me/push/subscriptions",
      expect.objectContaining({
        endpoint: "https://fcm.googleapis.com/fcm/send/abc",
        keys: { p256dh: "p256dh-key", auth: "auth-key" },
      }),
      expect.anything()
    );
    expect(mockPatch).toHaveBeenCalledWith(
      "/users/me/push/preferences",
      { enabled: true },
      expect.anything()
    );

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Push notifications enabled");
    });
  });

  it("unsubscribes from push without touching in-app notifications", async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === "/users/me/push/config") {
        return Promise.resolve({ data: { configured: true, public_key: "vapid-key" } });
      }
      if (url === "/users/me/push/subscriptions") {
        return Promise.resolve({ data: { enabled: true, subscriptions: [] } });
      }
      return Promise.resolve({ data: { notifications: [] } });
    });
    mockGetExistingPushSubscription.mockResolvedValue({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    });
    mockUnsubscribeFromPush.mockResolvedValue("https://fcm.googleapis.com/fcm/send/abc");
    mockPatch.mockResolvedValue({});
    mockDelete.mockResolvedValue({});

    render(<NotificationBell apiToken="test-token" />);
    fireEvent.click(await screen.findByRole("button", { name: /Notifications/i }));

    const toggle = await screen.findByRole("switch", { name: /Push notifications/i });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockUnsubscribeFromPush).toHaveBeenCalled();
    });
    expect(mockPatch).toHaveBeenCalledWith(
      "/users/me/push/preferences",
      { enabled: false },
      expect.anything()
    );
    expect(mockDelete).toHaveBeenCalledWith(
      "/users/me/push/subscriptions",
      expect.objectContaining({
        data: { endpoint: "https://fcm.googleapis.com/fcm/send/abc" },
      })
    );

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Push notifications disabled");
    });
  });
});

const unreadNotification = (id: string) => ({
  id,
  type: "payout_received",
  payload: { amount_usdc: "10.0" },
  created_at: new Date().toISOString(),
  read_at: null,
});

/** Route GETs: notifications from `notifications()`, push endpoints unconfigured. */
function serveNotifications(notifications: () => Promise<unknown>) {
  mockGet.mockImplementation((url: string) => {
    if (url === "/users/me/notifications") return notifications();
    if (url === "/users/me/push/config") {
      return Promise.resolve({ data: { configured: false, public_key: null } });
    }
    return Promise.resolve({ data: { enabled: false } });
  });
}

describe("NotificationBell polling failures (#844)", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    warn.mockRestore();
  });

  async function nextPoll() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
  }

  it("logs each failure and shows a degraded state after the threshold", async () => {
    serveNotifications(() => Promise.reject(new Error("503 Service Unavailable")));
    render(<NotificationBell apiToken="test-token" />);

    // The initial fetch plus THRESHOLD - 2 polls: one short of the threshold.
    await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    for (let i = 1; i < POLL_FAILURE_THRESHOLD - 1; i++) await nextPoll();
    expect(screen.queryByTestId("notification-bell-degraded")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Notifications/i })).toHaveAttribute(
      "data-state",
      "ok"
    );

    await nextPoll();
    await waitFor(() =>
      expect(screen.getByTestId("notification-bell-degraded")).toBeInTheDocument()
    );
    const bell = screen.getByRole("button", { name: /updates unavailable/i });
    expect(bell).toHaveAttribute("data-state", "degraded");
    expect(warn).toHaveBeenCalledTimes(POLL_FAILURE_THRESHOLD);
    expect(String(warn.mock.calls[0]?.[0])).toContain("failed to fetch notifications");

    fireEvent.click(bell);
    expect(screen.getByText(/Can't load new notifications right now/)).toBeInTheDocument();
  });

  it("does not stay degraded after one transient failure followed by success", async () => {
    let calls = 0;
    serveNotifications(() => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error("network down"))
        : Promise.resolve({ data: { notifications: [] } });
    });
    render(<NotificationBell apiToken="test-token" />);

    await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    await nextPoll();
    await waitFor(() => expect(calls).toBe(2));
    expect(screen.queryByTestId("notification-bell-degraded")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Notifications/i })).toHaveAttribute(
      "data-state",
      "ok"
    );
  });

  it("clears the degraded state once a poll succeeds again", async () => {
    let failing = true;
    serveNotifications(() =>
      failing ? Promise.reject(new Error("500")) : Promise.resolve({ data: { notifications: [] } })
    );
    render(<NotificationBell apiToken="test-token" />);
    await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    for (let i = 1; i < POLL_FAILURE_THRESHOLD; i++) await nextPoll();
    await waitFor(() =>
      expect(screen.getByTestId("notification-bell-degraded")).toBeInTheDocument()
    );

    failing = false;
    await nextPoll();
    await waitFor(() =>
      expect(screen.queryByTestId("notification-bell-degraded")).not.toBeInTheDocument()
    );
  });
});

describe("NotificationBell mark-read failures (#845)", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    serveNotifications(() =>
      Promise.resolve({
        data: { notifications: [unreadNotification("n1"), unreadNotification("n2")] },
      })
    );
  });

  afterEach(() => {
    warn.mockRestore();
  });

  async function openDrawer() {
    render(<NotificationBell apiToken="test-token" />);
    const bell = await screen.findByRole("button", { name: /Notifications \(2 unread\)/i });
    fireEvent.click(bell);
    await screen.findAllByRole("button", { name: "Mark as read" });
  }

  it("rolls a failed markRead back to unread, logs it and tells the user", async () => {
    let reject: (err: Error) => void = () => {};
    mockPatch.mockImplementationOnce(() => new Promise((_resolve, rej) => (reject = rej)));
    await openDrawer();

    fireEvent.click(screen.getAllByRole("button", { name: "Mark as read" })[0]!);
    // Optimistic: the item reads as read while the request is in flight.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Notifications \(1 unread\)/i })
      ).toBeInTheDocument()
    );

    await act(async () => reject(new Error("500")));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Notifications \(2 unread\)/i })
      ).toBeInTheDocument()
    );
    expect(screen.getAllByRole("button", { name: "Mark as read" })).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent("Couldn't mark notification as read");
    expect(String(warn.mock.calls[0]?.[0])).toContain("failed to mark notification n1 as read");
  });

  it("keeps a successful markRead", async () => {
    mockPatch.mockResolvedValueOnce({});
    await openDrawer();

    fireEvent.click(screen.getAllByRole("button", { name: "Mark as read" })[0]!);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Notifications \(1 unread\)/i })
      ).toBeInTheDocument()
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("rolls a failed markAllRead back to unread and logs it", async () => {
    mockPatch.mockRejectedValueOnce(new Error("API failure"));
    await openDrawer();

    fireEvent.click(screen.getByRole("button", { name: /Mark all read/i }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Failed to mark notifications as read")
    );
    expect(screen.getByRole("button", { name: /Notifications \(2 unread\)/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Mark as read" })).toHaveLength(2);
    expect(String(warn.mock.calls[0]?.[0])).toContain("failed to mark all notifications as read");
  });
});
