import prisma from '../core/db';
import { Prisma, OrderStatus } from '@prisma/client';

export class OrderRepository {
  async createDraft(rawDescription: string) {
    // Generate order_code e.g., ORD-2026-001
    const orderCount = await prisma.productionOrder.count();
    const orderCode = `ORD-${new Date().getFullYear()}-${String(orderCount + 1).padStart(3, '0')}`;

    return prisma.productionOrder.create({
      data: {
        orderCode,
        rawDescription,
        status: OrderStatus.DRAFT,
      },
    });
  }

  async findById(id: string) {
    return prisma.productionOrder.findUnique({
      where: { id },
      include: { aiAnalysis: true, batch: true },
    });
  }

  async updateStatus(id: string, status: OrderStatus, aiAnalysisId?: string) {
    // Fix: Use 'UncheckedUpdateInput' which allows updating scalar foreign key fields 
    // (like aiAnalysisId) directly without needing the '{ connect: { id } }' relation syntax.
    const updateData: Prisma.ProductionOrderUncheckedUpdateInput = { 
      status 
    };

    if (aiAnalysisId !== undefined) {
      updateData.aiAnalysisId = aiAnalysisId;
    }

    return prisma.productionOrder.update({
      where: { id },
      data: updateData,
    });
  }
}