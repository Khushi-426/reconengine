import { query, pool } from "../config/db.js";

/**
 * Creates a notification. If client is passed, runs within transaction.
 */
export async function createNotification(client, { userId, title, message, link }) {
  const db = client || pool;
  const sql = `
    INSERT INTO notifications (user_id, title, message, link)
    VALUES ($1, $2, $3, $4)
    RETURNING notification_id, user_id, title, message, link, is_read, created_at
  `;
  const result = await db.query(sql, [userId, title, message, link]);
  return result.rows[0];
}

/**
 * Lists user's notifications.
 */
export async function findUserNotifications({ userId, unreadOnly = false, page = 1, pageSize = 20 }) {
  const conditions = ["user_id = $1"];
  const params = [userId];

  if (unreadOnly) {
    conditions.push("is_read = FALSE");
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;
  const offset = (page - 1) * pageSize;
  params.push(pageSize, offset);

  const sql = `
    SELECT notification_id, title, message, link, is_read, created_at,
           COUNT(*) OVER() AS total_count
    FROM notifications
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3
  `;

  const result = await query(sql, params);
  const total = result.rows[0]?.total_count ? parseInt(result.rows[0].total_count, 10) : 0;

  return {
    data: result.rows.map(({ total_count, ...row }) => row),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

/**
 * Marks a notification as read.
 */
export async function markNotificationAsRead(client, { notificationId, userId }) {
  const db = client || pool;
  const sql = `
    UPDATE notifications
    SET is_read = TRUE
    WHERE notification_id = $1 AND user_id = $2
    RETURNING notification_id, is_read
  `;
  const result = await db.query(sql, [notificationId, userId]);
  return result.rows[0];
}

/**
 * Marks all notifications for a user as read.
 */
export async function markAllUserNotificationsAsRead(client, { userId }) {
  const db = client || pool;
  const sql = `
    UPDATE notifications
    SET is_read = TRUE
    WHERE user_id = $1 AND is_read = FALSE
    RETURNING notification_id
  `;
  const result = await db.query(sql, [userId]);
  return result.rows;
}

/**
 * Gets the number of unread notifications for a user.
 */
export async function countUnreadNotifications(userId) {
  const sql = `
    SELECT COUNT(*)::INT AS count
    FROM notifications
    WHERE user_id = $1 AND is_read = FALSE
  `;
  const result = await query(sql, [userId]);
  return result.rows[0].count;
}
