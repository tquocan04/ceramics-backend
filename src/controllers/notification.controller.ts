import { Request, Response } from 'express';
import { NotificationService } from '../services/notification.service';

const notificationService = new NotificationService();

/**
 * GET /api/notifications
 * Lists up to 200 most recent outbox entries.
 */
export const getNotifications = async (req: Request, res: Response): Promise<any> => {
  try {
    const notifications = await notificationService.listNotifications();
    return res.status(200).json({ notifications });
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Lỗi hệ thống không xác định.' }
    });
  }
};

/**
 * POST /api/notifications/:id/retry
 * Retries dispatching a failed notification.
 */
export const retryNotification = async (req: Request, res: Response): Promise<any> => {
  try {
    const result = await notificationService.retryNotification(req.params.id as string);
    return res.status(200).json(result);
  } catch (error: any) {
    if (error.message === 'NOTIFICATION_SEND_FAILED') {
      return res.status(404).json({
        error: {
          code: 'NOTIFICATION_SEND_FAILED',
          message: 'Không tìm thấy thông báo để gửi lại.'
        }
      });
    }
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Lỗi hệ thống không xác định.' }
    });
  }
};

/**
 * POST /api/notifications/trigger
 * Allows Next.js frontend to dispatch on-demand status broadcasts or alerts.
 */
export const triggerNotification = async (req: Request, res: Response): Promise<any> => {
  try {
    const { type, title = 'Thông báo xưởng gốm', message, level = 'INFO', batchCode, productName, quantity, batchId } = req.body || {};

    // Scenario A: Full batch completion broadcast
    if (type === 'BATCH_COMPLETED' && batchCode) {
      const result = await notificationService.notifyBatchCompleted(
        batchCode,
        productName || 'Gốm sứ',
        Number(quantity) || 0,
        batchId
      );
      return res.status(200).json({ success: true, notification: result });
    }

    // Scenario B: Custom status or incident broadcast
    if (!message) {
      return res.status(422).json({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Nội dung thông báo (message) không được để trống.'
        }
      });
    }

    const result = await notificationService.notifyCustomTrigger(title, message, level, batchId);
    return res.status(200).json({ success: true, notification: result });
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Lỗi hệ thống không xác định.' }
    });
  }
};