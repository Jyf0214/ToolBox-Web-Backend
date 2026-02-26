import { Router } from 'express';
import { configController } from './config.controller';

const router = Router();

/**
 * 暂定：此处应加入身份验证和权限校验中间件
 * 为了演示，先开放接口，生产环境必须配合 verifyToken, isAdmin 使用
 */
router.get('/smtp', configController.getSmtpConfig);
router.post('/smtp', configController.updateSmtpConfig);

export default router;
