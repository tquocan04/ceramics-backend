import { OrderRepository } from '../repositories/order.repository';
import { AIService } from './ai.service';
import prisma from '../core/db';
import { OrderStatus, StageType, StageStatus, Prisma } from '@prisma/client';

const STAGE_SEQUENCE = [
  StageType.FORMING,
  StageType.DRYING,
  StageType.DECORATING,
  StageType.GLAZING,
  StageType.FIRING,
  StageType.QUALITY_CHECK,
  StageType.PACKAGING,
];

export class OrderService {
  private orderRepo = new OrderRepository();
  private aiService = new AIService();

  async createOrder(rawDescription: string) {
    // Validate input description
    if (!rawDescription || rawDescription.trim().length === 0) {
      throw new Error('EMPTY_DESCRIPTION');
    }
    return this.orderRepo.createDraft(rawDescription);
  }

  async analyzeOrder(orderId: string) {
    // Fetch the order from the database
    const order = await this.orderRepo.findById(orderId);
    
    // Validate order existence
    if (!order) throw new Error('ORDER_NOT_FOUND');
    
    // Prevent re-analyzing if the order is already confirmed or has a production batch
    // Fix: Using 'order.batch' instead of 'order.batchId' to resolve the TS error
    if (order.status === OrderStatus.CONFIRMED || order.batch) {
      throw new Error('ORDER_ALREADY_CONFIRMED');
    }

    // 1. Update order status to indicate AI analysis is in progress
    await this.orderRepo.updateStatus(orderId, OrderStatus.AI_ANALYZING);

    // 2. Trigger the AI Agent to extract technical specifications
    const analysisResult = await this.aiService.extractCeramicsData(order.rawDescription);
    
    // 3. Persist the AI analysis result (even if it failed, for fault tolerance)
    const analysisRecord = await prisma.aIAnalysis.create({
      data: {
        orderId,
        model: 'gemini-2.5-flash',
        promptVersion: 'v1.0',
        rawResponse: JSON.stringify(analysisResult),
        result: analysisResult.isValid ? (analysisResult.data as any) : null,
        isValid: analysisResult.isValid,
        latencyMs: analysisResult.latency,
        errorCode: analysisResult.isValid ? null : 'AI_SCHEMA_VALIDATION_FAILED',
      },
    });

    // 4. Determine the final status and update the order
    const finalStatus = analysisResult.isValid 
      ? OrderStatus.PENDING_CONFIRMATION 
      : OrderStatus.AI_ANALYSIS_FAILED;
      
    return this.orderRepo.updateStatus(orderId, finalStatus, analysisRecord.id);
  }

  async confirmOrder(orderId: string, overrides: any = {}) {
    const order = await prisma.productionOrder.findUnique({
      where: { id: orderId },
      include: { aiAnalysis: true },
    });

    if (!order) throw new Error('ORDER_NOT_FOUND');
    if (order.status === OrderStatus.CANCELLED) throw new Error('ORDER_CANNOT_BE_CANCELLED');
    
    // Đảm bảo đơn đã được AI phân tích thành công
    if (!order.aiAnalysis || !order.aiAnalysis.isValid || !order.aiAnalysis.result) {
      throw new Error('ORDER_NOT_ANALYZED');
    }

    // Nếu đơn đã có Batch rồi thì trả về luôn (Idempotent)
    if (order.batchId) {
      const existingBatch = await prisma.productionBatch.findUnique({
        where: { id: order.batchId },
        include: { stages: { orderBy: { sequence: 'asc' } } }
      });
      return { order, batch: existingBatch, stages: existingBatch?.stages };
    }

    // Parse result from AI
    const aiResult = order.aiAnalysis.result as any;
    const finalQuantity = overrides.spec?.extracted?.quantity ?? aiResult.extracted.quantity;
    
    if (!finalQuantity || finalQuantity <= 0) {
      throw new Error('VALIDATION_FAILED');
    }

    const batchCount = await prisma.productionBatch.count();
    const batchCode = `GOM-${String(batchCount + 1).padStart(4, '0')}`;
    
    // Merge dữ liệu ghi đè từ quản lý (nếu có) với dữ liệu AI
    const spec = {
      extracted: { ...aiResult.extracted, ...overrides.spec?.extracted },
      estimated: { ...aiResult.estimated, ...overrides.spec?.estimated },
      priority: overrides.priority ?? aiResult.priority ?? 'NORMAL',
      priority_reason: overrides.spec?.priority_reason ?? aiResult.priority_reason,
      provenance: aiResult.provenance
    };

    // Use Transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Tạo Mẻ sản xuất (Batch)
      const batch = await tx.productionBatch.create({
        data: {
          batchCode,
          productName: spec.extracted.product_name || 'Sản phẩm chưa rõ tên',
          quantity: finalQuantity,
          priority: spec.priority,
          deadline: overrides.deadline ?? order.requestedDeadline ?? new Date(Date.now() + (spec.extracted.deadline_days || 14) * 86400000),
          spec: spec as any,
          orderId: order.id
        }
      });

      // 2. Create 7 stages
      const stagesData = STAGE_SEQUENCE.map((stageType, index) => ({
        batchId: batch.id,
        stageType: stageType,
        sequence: index + 1,
        status: StageStatus.PENDING
      }));

      await tx.productionStage.createMany({ data: stagesData });

      // 3. Cập nhật lại Order
      const updatedOrder = await tx.productionOrder.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.CONFIRMED,
          batchId: batch.id
        }
      });

      // 4. Lấy lại danh sách stages để trả về
      const stages = await tx.productionStage.findMany({
        where: { batchId: batch.id },
        orderBy: { sequence: 'asc' }
      });

      return { order: updatedOrder, batch, stages };
    });

    return result;
  }
}