import { Router } from 'express';
import { configController } from './config.controller';
import { verifyToken, isAdmin } from '../../shared/middlewares/auth.middleware';

const router = Router();

// 所有配置接口均需管理员权限
router.get('/smtp', verifyToken, isAdmin, configController.getSmtpConfig);
router.post('/smtp', verifyToken, isAdmin, configController.updateSmtpConfig);
router.post('/test-smtp', verifyToken, isAdmin, configController.testSmtp);

export default router;
