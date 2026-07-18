import { vi, describe, it, expect, beforeEach } from "vitest";
import {
  sendAlert,
  getUserNotifications,
  markAsRead,
  markAllAsRead,
  getUnreadCount,
} from "../src/services/notificationsService.js";
import * as notificationsRepo from "../src/repositories/notificationsRepository.js";

vi.mock("../src/config/db.js", () => {
  return {
    withTransaction: vi.fn(async (fn) => {
      const mockClient = {};
      return fn(mockClient);
    }),
    query: vi.fn(),
  };
});

vi.mock("../src/repositories/notificationsRepository.js", () => {
  return {
    createNotification: vi.fn(),
    findUserNotifications: vi.fn(),
    markNotificationAsRead: vi.fn(),
    markAllUserNotificationsAsRead: vi.fn(),
    countUnreadNotifications: vi.fn(),
  };
});

describe("notificationsService", () => {
  const userId = "00000000-0000-0000-0000-000000000001";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends an alert inside a client transaction context", async () => {
    const mockClient = {};
    const mockPayload = { userId, title: "Test Alert", message: "Hello", link: "/test" };
    vi.mocked(notificationsRepo.createNotification).mockResolvedValueOnce({
      notification_id: 1,
      ...mockPayload,
      is_read: false,
    });

    const result = await sendAlert(mockClient, mockPayload);
    expect(result.notification_id).toBe(1);
    expect(notificationsRepo.createNotification).toHaveBeenCalledWith(mockClient, mockPayload);
  });

  it("lists user notifications with correct parameters", async () => {
    vi.mocked(notificationsRepo.findUserNotifications).mockResolvedValueOnce({
      data: [{ notification_id: 1, title: "Alert" }],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });

    const result = await getUserNotifications(userId, { unreadOnly: true });
    expect(result.data.length).toBe(1);
    expect(notificationsRepo.findUserNotifications).toHaveBeenCalledWith({
      userId,
      unreadOnly: true,
      page: 1,
      pageSize: 20,
    });
  });

  it("marks a notification as read within transaction", async () => {
    vi.mocked(notificationsRepo.markNotificationAsRead).mockResolvedValueOnce({
      notification_id: 10,
      is_read: true,
    });

    const result = await markAsRead(10, userId);
    expect(result.notification_id).toBe(10);
    expect(result.is_read).toBe(true);
  });

  it("marks all notifications read within transaction", async () => {
    vi.mocked(notificationsRepo.markAllUserNotificationsAsRead).mockResolvedValueOnce([
      { notification_id: 1 },
      { notification_id: 2 },
    ]);

    const result = await markAllAsRead(userId);
    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
  });

  it("gets unread notification counts", async () => {
    vi.mocked(notificationsRepo.countUnreadNotifications).mockResolvedValueOnce(5);

    const count = await getUnreadCount(userId);
    expect(count).toBe(5);
  });
});
