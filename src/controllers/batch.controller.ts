import { Request, Response } from 'express';
import { WorkflowService } from '../services/workflow.service';
import { StageType } from '@prisma/client';

const workflowService = new WorkflowService();

export const startStage = async (req: Request, res: Response): Promise<any> => {
  try {
    const batchId = req.params.id as string;
    const stageParam = req.params.stage as string;

    // Validate if stage parameter exists
    if (!stageParam) {
      return res.status(400).json({ error: { code: 'INVALID_STAGE', message: 'Stage parameter is missing.' } });
    }

    // Normalize stage string from URL to match Prisma Enum (e.g., 'forming' -> 'FORMING')
    const stageType = stageParam.toUpperCase() as StageType; 
    
    if (!Object.values(StageType).includes(stageType)) {
      return res.status(404).json({ error: { code: 'STAGE_NOT_FOUND', message: 'Invalid production stage.' } });
    }

    const note = req.body?.note;
    const result = await workflowService.startStage(batchId, stageType, note);
    return res.status(200).json(result);
  } catch (error: any) {
    // Map domain errors to appropriate HTTP status codes
    const mapping: Record<string, number> = {
      'BATCH_NOT_FOUND': 404,
      'STAGE_NOT_FOUND': 404,
      'BATCH_CANCELLED': 409,
      'BATCH_BLOCKED': 409,
      'STAGE_ALREADY_IN_PROGRESS': 409,
      'STAGE_ALREADY_COMPLETED': 409,
      'ANOTHER_STAGE_IN_PROGRESS': 409,
      'PREVIOUS_STAGE_NOT_COMPLETED': 409,
    };
    
    const statusCode = mapping[error.message] || 500;
    const msg = statusCode === 500 ? 'Internal server error.' : error.message;
    
    return res.status(statusCode).json({ error: { code: error.message, message: msg } });
  }
};

export const completeStage = async (req: Request, res: Response): Promise<any> => {
  try {
    const batchId = req.params.id as string;
    const stageParam = req.params.stage as string;

    // Validate if stage parameter exists
    if (!stageParam) {
      return res.status(400).json({ error: { code: 'INVALID_STAGE', message: 'Stage parameter is missing.' } });
    }

    const stageType = stageParam.toUpperCase() as StageType;
    
    const note = req.body?.note;
    const result = await workflowService.completeStage(batchId, stageType, note);
    return res.status(200).json(result);
  } catch (error: any) {
    if (error.message === 'STAGE_NOT_STARTED') {
      return res.status(409).json({ error: { code: 'STAGE_NOT_STARTED', message: 'Stage has not been started yet.' } });
    }
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' } });
  }
};

export const failStage = async (req: Request, res: Response): Promise<any> => {
  try {
    const batchId = req.params.id as string;
    const stageParam = req.params.stage as string;

    if (!stageParam) {
      return res.status(404).json({ error: { code: 'STAGE_NOT_FOUND', message: 'Stage parameter missing.' } });
    }

    const stageType = stageParam.toUpperCase() as StageType;
    if (!Object.values(StageType).includes(stageType)) {
      return res.status(404).json({ error: { code: 'STAGE_NOT_FOUND', message: 'Stage not found.', details: { stage: stageParam } } });
    }

    const reason = req.body?.reason || 'Không rõ nguyên nhân';
    const result = await workflowService.failStage(batchId, stageType, reason);
    
    return res.status(200).json(result);
  } catch (error: any) {
    if (error.message === 'BATCH_NOT_FOUND') {
      return res.status(404).json({ error: { code: 'BATCH_NOT_FOUND', message: 'Không tìm thấy mẻ gốm.' } });
    }
    if (error.message === 'STAGE_NOT_STARTED') {
      return res.status(409).json({ error: { code: 'STAGE_NOT_STARTED', message: 'Công đoạn chưa được bắt đầu.' } });
    }
    if (error.message === 'BATCH_CANCELLED') {
      return res.status(409).json({ error: { code: 'BATCH_CANCELLED', message: 'Mẻ gốm đã bị hủy.' } });
    }
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Lỗi hệ thống không xác định.' } });
  }
};