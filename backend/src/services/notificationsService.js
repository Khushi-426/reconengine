import { withTransaction } from "../config/db.js";
import {
  createNotification,
  findUserNotifications,
  markNotificationAsRead,
  markAllUserNotificationsAsRead,
  countUnreadNotifications,
} from "../repositories/notificationsRepository.js";

/**
 * Creates and logs a notification (runs inside a client transaction).
 */
export async function sendAlert(client, { userId, title, message, link }) {
  return createNotification(client, { userId, title, message, link });
}

/**
 * Lists user's notifications.
 */
export async function getUserNotifications(userId, { unreadOnly = false, page = 1, pageSize = 20 } = {}) {
  return findUserNotifications({ userId, unreadOnly, page, pageSize });
}

/**
 * Marks a notification as read.
 */
export async function markAsRead(notificationId, userId) {
  return withTransaction(
    (client) => markNotificationAsRead(client, { notificationId, userId })
  );
}

/**
 * Marks all notifications for a user as read.
 */
export async function markAllAsRead(userId) {
  const rows = await withTransaction(
    (client) => markAllUserNotificationsAsRead(client, { userId })
  );
  return { success: true, count: rows ? rows.length : 0 };
}

/**
 * Gets count of unread notifications.
 */
export async function getUnreadCount(userId) {
  return countUnreadNotifications(userId);
}
