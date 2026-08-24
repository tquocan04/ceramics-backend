import { Router, Request, Response } from 'express';

const router = Router();

router.get('/', async (req: Request, res: Response): Promise<any> => {
  return res.status(200).json({
    Message: "Good"
  });
});

export default router;
