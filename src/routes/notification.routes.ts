import { Router } from 'express';
import { getNotifications, retryNotification, triggerNotification } from '../controllers/notification.controller';

const router = Router();

// GET /api/notifications -> List Telegram Outbox (§11.5 in openapi.json)
router.get('/', getNotifications);

// POST /api/notifications/trigger -> Client trigger endpoint for Next.js
router.post('/trigger', triggerNotification);

// POST /api/notifications/:id/retry -> Retry failed message (§11.6 in openapi.json)
router.post('/:id/retry', retryNotification);

export default router;