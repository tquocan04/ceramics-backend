import { Router } from 'express';
import { startStage, completeStage, failStage } from '../controllers/batch.controller';

const router = Router();

router.post('/:id/stages/:stage/start', startStage);
router.post('/:id/stages/:stage/complete', completeStage);
router.post('/:id/stages/:stage/fail', failStage);

export default router;