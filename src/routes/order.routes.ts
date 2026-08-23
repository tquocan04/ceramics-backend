import { Router } from 'express';
import { createOrder, analyzeOrder, confirmOrder } from '../controllers/order.controller';

const router = Router();

router.post('/', createOrder);
router.post('/:id/analyze', analyzeOrder);
router.post('/:id/confirm', confirmOrder); // Gắn route mới vào đây

export default router;