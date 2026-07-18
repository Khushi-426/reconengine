import * as notificationsService from "../services/notificationsService.js";

export async function listNotificationsHandler(req, res, next) {
  try {
    const { unreadOnly, page, pageSize } = req.query;
    const result = await notificationsService.getUserNotifications(req.user.userId, {
      unreadOnly: unreadOnly === "true",
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? Math.min(parseInt(pageSize, 10), 100) : 20,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function unreadCountHandler(req, res, next) {
  try {
    const count = await notificationsService.getUnreadCount(req.user.userId);
    res.json({ count });
  } catch (err) {
    next(err);
  }
}

export async function markReadHandler(req, res, next) {
  try {
    const { notificationId } = req.params;
    const result = await notificationsService.markAsRead(parseInt(notificationId, 10), req.user.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function markAllReadHandler(req, res, next) {
  try {
    const result = await notificationsService.markAllAsRead(req.user.userId);
    res.json({ success: true, count: result.length });
  } catch (err) {
    next(err);
  }
}
