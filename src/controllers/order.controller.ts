import { Request, Response } from 'express';
import { OrderService } from '../services/order.service';

const orderService = new OrderService();

export const createOrder = async (req: Request, res: Response): Promise<any> => {
  try {
    const { raw_description } = req.body;
    
    // For sure raw_description is string
    if (typeof raw_description !== 'string') {
      return res.status(422).json({ error: { code: 'EMPTY_DESCRIPTION', message: 'Mô tả không hợp lệ hoặc bị trống.' } });
    }

    const order = await orderService.createOrder(raw_description);
    return res.status(200).json(order);
  } catch (error: any) {
    if (error.message === 'EMPTY_DESCRIPTION') {
      return res.status(422).json({ error: { code: 'EMPTY_DESCRIPTION', message: 'Mô tả không được để trống.' } });
    }
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Lỗi hệ thống không xác định.' } });
  }
};

export const analyzeOrder = async (req: Request, res: Response): Promise<any> => {
  try {
    const orderId = req.params.id as string;
    
    if (!orderId) {
      return res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Thiếu mã đơn hàng.' } });
    }

    const order = await orderService.analyzeOrder(orderId);
    return res.status(200).json(order);
  } catch (error: any) {
    if (error.message === 'ORDER_NOT_FOUND') {
      return res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Không tìm thấy đơn hàng.' } });
    }
    if (error.message === 'ORDER_ALREADY_CONFIRMED') {
      return res.status(409).json({ error: { code: 'ORDER_ALREADY_CONFIRMED', message: 'Đơn hàng đã được xác nhận, không thể phân tích lại.' } });
    }
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Lỗi hệ thống.' } });
  }
};

export const confirmOrder = async (req: Request, res: Response): Promise<any> => {
  try {
    const orderId = req.params.id as string;
    const result = await orderService.confirmOrder(orderId, req.body);
    return res.status(200).json(result);
  } catch (error: any) {
    if (error.message === 'ORDER_NOT_FOUND') return res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Không tìm thấy đơn hàng.' } });
    if (error.message === 'ORDER_NOT_ANALYZED') return res.status(409).json({ error: { code: 'ORDER_NOT_ANALYZED', message: 'Đơn hàng chưa phân tích AI xong.' } });
    if (error.message === 'ORDER_CANNOT_BE_CANCELLED') return res.status(409).json({ error: { code: 'ORDER_CANNOT_BE_CANCELLED', message: 'Đơn hàng đã bị hủy.' } });
    if (error.message === 'VALIDATION_FAILED') return res.status(422).json({ error: { code: 'VALIDATION_FAILED', message: 'Dữ liệu không hợp lệ (kiểm tra lại số lượng).' } });
    
    console.error(error);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Lỗi hệ thống.' } });
  }
};