import prisma from '../core/db';
import { NotificationStatus, NotificationChannel } from '@prisma/client';

export class NotificationService {
  private botToken = process.env.TELEGRAM_BOT_TOKEN;
  private chatId = process.env.TELEGRAM_CHAT_ID;

  /**
   * Sends a message to Telegram using native fetch and records logs.
   */
  async sendTelegram(eventId: string | null, message: string) {
    let notificationId: string | null = null;

    if (eventId) {
      const record = await prisma.notification.create({
        data: {
          eventId,
          channel: NotificationChannel.TELEGRAM,
          payload: message,
          status: NotificationStatus.PENDING,
        }
      });
      notificationId = record.id;
    }

    if (!this.botToken || !this.chatId) {
      console.warn('[NotificationService] Telegram credentials missing in .env');
      return;
    }

    try {
      const res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: message,
          parse_mode: 'HTML'
        })
      });

      if (!res.ok) throw new Error(`Telegram API Error: ${res.statusText}`);

      if (notificationId) {
        await prisma.notification.update({
          where: { id: notificationId },
          data: { status: NotificationStatus.SENT, sentAt: new Date() }
        });
      }
    } catch (err: any) {
      console.error('[NotificationService] Failed to send telegram alert:', err.message);
      if (notificationId) {
        await prisma.notification.update({
          where: { id: notificationId },
          data: { status: NotificationStatus.FAILED, errorMessage: err.message, retryCount: { increment: 1 } }
        });
      }
    }
  }

  /**
   * Format normal stage transition with parameters (e.g., Firing temperature, Drying time)
   */
  async notifyStageUpdate(batchCode: string, stage: string, details?: Record<string, any>, eventId?: string) {
    let detailLines = '';
    if (details && Object.keys(details).length > 0) {
      detailLines = '\n<b>Thông số kỹ thuật:</b>\n' + 
        Object.entries(details).map(([k, v]) => `• ${k}: <code>${v}</code>`).join('\n');
    }

    const msg = 
      `🏺 <b>CẬP NHẬT CÔNG ĐOẠN XƯỞNG</b>\n` +
      `───────────────────\n` +
      `• Mẻ gốm: <b>#${batchCode}</b>\n` +
      `• Công đoạn: <b>${stage}</b>\n` +
      `• Thời gian: <code>${new Date().toLocaleTimeString('vi-VN')}</code>` +
      detailLines;

    await this.sendTelegram(eventId ?? null, msg);
  }

  /**
   * Format Emergency / QC Incident Red Alert
   */
  async notifyEmergencyAlert(batchCode: string, stage: string, issue: string, defectCount?: number, actionRequired?: string, eventId?: string) {
    const msg = 
      `🚨 <b>CẢNH BÁO SỰ CỐ KHẨN CẤP - XƯỞNG GỐM</b> 🚨\n` +
      `───────────────────\n` +
      `• Mẻ gốm: <b>#${batchCode}</b>\n` +
      `• Công đoạn phát hiện: <b>${stage}</b>\n` +
      `• Số lượng lỗi: <b>${defectCount ?? 'Chưa xác định'} sản phẩm</b>\n` +
      `• Chi tiết sự cố: <i>${issue}</i>\n` +
      `• Yêu cầu xử lý: <b>${actionRequired ?? 'Quản đốc kiểm tra trực tiếp'}</b>\n` +
      `───────────────────\n` +
      `⚠️ <i>Dây chuyền đối với mẻ này đã được tạm dừng!</i>`;

    await this.sendTelegram(eventId ?? null, msg);
  }
}