import prisma from '../core/db';
import { NotificationStatus, NotificationChannel, EventType, Role, Prisma, Notification } from '@prisma/client';

export class NotificationService {
  private botToken = process.env.TELEGRAM_BOT_TOKEN;
  private chatId = process.env.TELEGRAM_CHAT_ID;

  /**
   * Escapes reserved HTML characters to prevent Telegram parse errors.
   */
  escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Core dispatcher implementing the Transactional Outbox pattern.
   * Persists an initial PENDING record, sends the HTTP POST request to Telegram,
   * and updates the status to SENT or FAILED accordingly.
   * Never throws: every failure path is contained so awaited callers cannot crash.
   */
  async sendTelegramRaw(eventId: string, payloadText: string): Promise<Notification | null> {
    try {
      // 1. Persist notification in database with foreign key to WorkflowEvent
      const record = await prisma.notification.create({
        data: {
          eventId,
          channel: NotificationChannel.TELEGRAM,
          payload: payloadText,
          status: NotificationStatus.PENDING,
        }
      });

      return await this.deliverNotification(record);
    } catch (error) {
      console.error('[NotificationService] Outbox dispatch failed unexpectedly:', error);
      return null;
    }
  }

  /**
   * Delivers an existing outbox record to Telegram and reflects the outcome
   * (SENT or FAILED) back onto that same record.
   */
  private async deliverNotification(record: Notification): Promise<Notification> {
    if (!this.botToken || !this.chatId) {
      console.warn('[NotificationService] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in environment variables.');
      return record;
    }

    // 2. Dispatch HTTP POST request to Telegram Bot API
    try {
      const response = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: record.payload,
          parse_mode: 'HTML'
        })
      });

      if (!response.ok) {
        throw new Error(`Telegram API rejected request: ${response.statusText}`);
      }

      // 3. Mark notification as SENT on success
      return await prisma.notification.update({
        where: { id: record.id },
        data: {
          status: NotificationStatus.SENT,
          sentAt: new Date(),
          errorMessage: null
        }
      });
    } catch (error: any) {
      // 4. Mark notification as FAILED and increment retry counter
      console.error('[NotificationService] Message delivery failed:', error.message);

      try {
        return await prisma.notification.update({
          where: { id: record.id },
          data: {
            status: NotificationStatus.FAILED,
            errorMessage: error.message,
            retryCount: { increment: 1 }
          }
        });
      } catch (persistError) {
        console.error('[NotificationService] Failed to persist FAILED state:', persistError);
        return record;
      }
    }
  }

  /**
   * Generates a structured completion announcement when a batch finishes production.
   */
  async notifyBatchCompleted(batchCode: string, productName: string, quantity: number, batchId?: string) {
    const safeBatch = this.escapeHtml(batchCode);
    const safeProduct = this.escapeHtml(productName);
    const text = 
      `🎉 <b>HOÀN THÀNH TOÀN BỘ MẺ GỐM</b> 🎉\n` +
      `───────────────────\n` +
      `• Mã mẻ: <b>#${safeBatch}</b>\n` +
      `• Sản phẩm: <b>${safeProduct}</b>\n` +
      `• Số lượng thành phẩm: <b>${quantity} cái</b>\n` +
      `• Thời gian hoàn thành: <code>${new Date().toLocaleString('vi-VN')}</code>\n` +
      `───────────────────\n` +
      `📦 <i>Mẻ gốm đã sẵn sàng để xuất xưởng!</i>`;

    // Construct event data safely for exactOptionalPropertyTypes
    const eventData: Prisma.WorkflowEventCreateInput = {
      eventType: EventType.BATCH_COMPLETED,
      message: `Hoàn thành toàn bộ mẻ gốm #${batchCode}`,
      createdBy: Role.SYSTEM
    };

    if (batchId) {
      const existingBatch = await prisma.productionBatch.findUnique({ where: { id: batchId } });
      if (existingBatch) {
        eventData.batch = { connect: { id: batchId } };
      }
    }

    const event = await prisma.workflowEvent.create({ data: eventData });

    return this.sendTelegramRaw(event.id, text);
  }

  /**
   * Formats and dispatches custom triggers or emergency warnings triggered by the client.
   */
  async notifyCustomTrigger(title: string, message: string, level: 'INFO' | 'WARNING' | 'CRITICAL' = 'INFO', batchId?: string) {
    const safeTitle = this.escapeHtml(title);
    const safeMessage = this.escapeHtml(message);
    const icon = level === 'CRITICAL' ? '🚨' : level === 'WARNING' ? '⚠️' : '📢';

    const text = 
      `${icon} <b>${safeTitle.toUpperCase()}</b>\n` +
      `───────────────────\n` +
      `${safeMessage}\n` +
      `───────────────────\n` +
      `🕒 <code>${new Date().toLocaleTimeString('vi-VN')}</code>`;

    const eventType = level === 'CRITICAL' 
      ? EventType.QC_CRITICAL 
      : level === 'WARNING' 
        ? EventType.QC_WARNING 
        : EventType.STAGE_STARTED;

    // Construct event data safely for exactOptionalPropertyTypes
    const eventData: Prisma.WorkflowEventCreateInput = {
      eventType,
      message: `[${level}] ${title}: ${message}`,
      createdBy: Role.SYSTEM
    };

    if (batchId) {
      const existingBatch = await prisma.productionBatch.findUnique({ where: { id: batchId } });
      if (existingBatch) {
        eventData.batch = { connect: { id: batchId } };
      }
    }

    const event = await prisma.workflowEvent.create({ data: eventData });

    return this.sendTelegramRaw(event.id, text);
  }

  /**
   * Retries delivering an existing failed notification by its ID (§11.6 in openapi.json).
   * Reuses the original outbox record instead of creating a duplicate entry.
   */
  async retryNotification(notificationId: string) {
    const record = await prisma.notification.findUnique({
      where: { id: notificationId }
    });

    if (!record) {
      throw new Error('NOTIFICATION_SEND_FAILED');
    }

    const pendingRecord = await prisma.notification.update({
      where: { id: record.id },
      data: { status: NotificationStatus.PENDING }
    });

    return this.deliverNotification(pendingRecord);
  }

  /**
   * Retrieves the 200 most recent notifications for outbox monitoring (§11.5 in openapi.json).
   */
  async listNotifications() {
    return prisma.notification.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200
    });
  }
}