import { Router } from 'express';
import { logController } from './log.controller';
import { verifyToken, isAdmin } from '../../shared/middlewares/auth.middleware';

const router = Router();

router.get('/', verifyToken, isAdmin, (req, res, next) => logController.getLogs(req, res, next));

export default router;
