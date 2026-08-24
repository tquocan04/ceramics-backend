import prisma from '../core/db';
import { StageType, StageStatus, BatchStatus, EventType, Role, Prisma } from '@prisma/client';
import { NotificationService } from './notification.service';

export class WorkflowService {
  private notificationService = new NotificationService();

  /**
   * Starts a pending stage for a batch.
   * Includes strict guard logic to prevent skipping stages or concurrent active stages.
   */
  async startStage(batchId: string, stageType: StageType, note?: string) {
    return prisma.$transaction(async (tx) => {
      // 1. Fetch the batch and all its stages sorted by sequence
      const batch = await tx.productionBatch.findUnique({
        where: { id: batchId },
        include: { stages: { orderBy: { sequence: 'asc' } } }
      });

      if (!batch) throw new Error('BATCH_NOT_FOUND');
      if (batch.status === BatchStatus.CANCELLED) throw new Error('BATCH_CANCELLED');
      if (batch.status === BatchStatus.BLOCKED) throw new Error('BATCH_BLOCKED');

      const targetStage = batch.stages.find(s => s.stageType === stageType);
      if (!targetStage) throw new Error('STAGE_NOT_FOUND');

      // 2. Guard Logic: State Validation
      if (targetStage.status === StageStatus.IN_PROGRESS) throw new Error('STAGE_ALREADY_IN_PROGRESS');
      if (targetStage.status === StageStatus.COMPLETED) throw new Error('STAGE_ALREADY_COMPLETED');

      // Ensure no other stage is currently running
      const activeStage = batch.stages.find(s => s.status === StageStatus.IN_PROGRESS);
      if (activeStage) throw new Error('ANOTHER_STAGE_IN_PROGRESS');

      // Ensure the previous stage in the sequence is COMPLETED
      if (targetStage.sequence > 1) {
        const prevStage = batch.stages.find(s => s.sequence === targetStage.sequence - 1);
        if (!prevStage || prevStage.status !== StageStatus.COMPLETED) {
          throw new Error('PREVIOUS_STAGE_NOT_COMPLETED');
        }
      }

      // 3. Execute Updates safely (handling exactOptionalPropertyTypes)
      const stageUpdateData: Prisma.ProductionStageUpdateInput = {
        status: StageStatus.IN_PROGRESS,
        startedAt: new Date(),
      };

      if (note !== undefined) {
        stageUpdateData.note = note;
      }

      const updatedStage = await tx.productionStage.update({
        where: { id: targetStage.id },
        data: stageUpdateData
      });

      const updatedBatch = await tx.productionBatch.update({
        where: { id: batch.id },
        data: {
          status: BatchStatus.IN_PRODUCTION,
          currentStage: stageType,
          startedAt: batch.startedAt ?? new Date()
        }
      });

      // 4. Record Immutable Audit Trail
      await tx.workflowEvent.create({
        data: {
          batchId: batch.id,
          orderId: batch.orderId,
          eventType: EventType.STAGE_STARTED,
          stage: stageType,
          message: `Bắt đầu công đoạn: ${stageType}`,
          createdBy: Role.WORKER
        }
      });

      return { batch: updatedBatch, stage: updatedStage };
    });
  }

  /**
   * Completes an in-progress stage and moves the batch forward.
   */
  async completeStage(batchId: string, stageType: StageType, note?: string) {
    const result = await prisma.$transaction(async (tx) => {
      const batch = await tx.productionBatch.findUnique({
        where: { id: batchId },
        include: { stages: { orderBy: { sequence: 'asc' } } }
      });

      if (!batch) throw new Error('BATCH_NOT_FOUND');
      if (batch.status === BatchStatus.CANCELLED) throw new Error('BATCH_CANCELLED');

      const targetStage = batch.stages.find(s => s.stageType === stageType);
      if (!targetStage) throw new Error('STAGE_NOT_FOUND');

      // Idempotency: If already completed, just return
      if (targetStage.status === StageStatus.COMPLETED) {
        return { batch, stage: targetStage, event: null }; 
      }

      if (targetStage.status !== StageStatus.IN_PROGRESS) {
        throw new Error('STAGE_NOT_STARTED');
      }

      // 1. Update current stage safely
      const stageUpdateData: Prisma.ProductionStageUpdateInput = {
        status: StageStatus.COMPLETED,
        completedAt: new Date(),
      };

      if (note !== undefined) {
        stageUpdateData.note = note;
      } else {
        stageUpdateData.note = targetStage.note;
      }

      const updatedStage = await tx.productionStage.update({
        where: { id: targetStage.id },
        data: stageUpdateData
      });

      // 2. Check if this is the final stage
      const isLastStage = targetStage.sequence === batch.stages.length;
      
      const updatedBatch = await tx.productionBatch.update({
        where: { id: batch.id },
        data: {
          status: isLastStage ? BatchStatus.COMPLETED : batch.status,
          completedAt: isLastStage ? new Date() : null
        }
      });

      // 3. Record Audit Trail
      const event = await tx.workflowEvent.create({
        data: {
          batchId: batch.id,
          orderId: batch.orderId,
          eventType: isLastStage ? EventType.BATCH_COMPLETED : EventType.STAGE_COMPLETED,
          stage: stageType,
          message: isLastStage ? `Hoàn thành mẻ gốm` : `Hoàn thành công đoạn: ${stageType}`,
          createdBy: Role.WORKER
        }
      });

      return { batch: updatedBatch, stage: updatedStage, event };
    });

    // 4. Fire notification only if an event was created
    if (result.event) {
      const safeStage = this.notificationService.escapeHtml(stageType);
      const alertMessage = `✅ <b>Cập nhật tiến độ xưởng</b>\n\nMẻ gốm: <b>#${result.batch.batchCode}</b>\nCông đoạn: <b>${safeStage}</b> đã hoàn tất!`;
      await this.notificationService.sendTelegramRaw(result.event.id, alertMessage);
    }

    return { batch: result.batch, stage: result.stage };
  }

  /**
   * Fails a running stage, blocking the batch.
   * Matches OpenAPI contract: POST /api/batches/{id}/stages/{stage}/fail
   */
  async failStage(batchId: string, stageType: StageType, reason: string = 'Không rõ nguyên nhân') {
    const result = await prisma.$transaction(async (tx) => {
      const batch = await tx.productionBatch.findUnique({
        where: { id: batchId },
        include: { stages: { orderBy: { sequence: 'asc' } } }
      });

      if (!batch) throw new Error('BATCH_NOT_FOUND');
      if (batch.status === BatchStatus.CANCELLED) throw new Error('BATCH_CANCELLED');

      const targetStage = batch.stages.find(s => s.stageType === stageType);
      if (!targetStage) throw new Error('STAGE_NOT_FOUND');

      if (targetStage.status !== StageStatus.IN_PROGRESS) {
        throw new Error('STAGE_NOT_STARTED');
      }

      // 1. Mark stage as FAILED
      const updatedStage = await tx.productionStage.update({
        where: { id: targetStage.id },
        data: {
          status: StageStatus.FAILED,
          note: reason
        }
      });

      // 2. Block the entire batch
      const updatedBatch = await tx.productionBatch.update({
        where: { id: batch.id },
        data: { status: BatchStatus.BLOCKED }
      });

      // 3. Record Audit Trail
      const event = await tx.workflowEvent.create({
        data: {
          batchId: batch.id,
          orderId: batch.orderId,
          eventType: EventType.STAGE_FAILED,
          stage: stageType,
          message: `Sự cố công đoạn ${stageType}: ${reason}`,
          createdBy: Role.WORKER
        }
      });

      return { batch: updatedBatch, stage: updatedStage, event };
    });

    // 4. Fire emergency red alert
    const safeStage = this.notificationService.escapeHtml(stageType);
    const safeReason = this.notificationService.escapeHtml(reason);
    const redAlertMessage = 
      `🚨 <b>CẢNH BÁO SỰ CỐ KHẨN CẤP</b> 🚨\n` +
      `───────────────────\n` +
      `• Mẻ gốm: <b>#${result.batch.batchCode}</b>\n` +
      `• Công đoạn phát hiện: <b>${safeStage}</b>\n` +
      `• Chi tiết sự cố: <i>${safeReason}</i>\n` +
      `───────────────────\n` +
      `⚠️ <i>Dây chuyền mẻ gốm này đã bị tạm dừng (BLOCKED)!</i>`;

    await this.notificationService.sendTelegramRaw(result.event.id, redAlertMessage);

    return { batch: result.batch, stage: result.stage };
  }
}