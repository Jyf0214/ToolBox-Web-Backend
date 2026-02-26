import { Router } from 'express';
import { configController } from './config.controller';
import { verifyToken, isAdmin } from '../../shared/middlewares/auth.middleware';

const router = Router();

// 元数据架构 (公开或带鉴权均可，此处设为带鉴权)
router.get('/schema', verifyToken, isAdmin, configController.getSchema);
router.get('/health', configController.getHealth); // 公开接口，用于首页状态展示

// 批量读写配置
router.get('/all', verifyToken, isAdmin, configController.getAllConfigs);
router.post('/batch', verifyToken, isAdmin, configController.updateConfigs);

// 保留 SMTP 测试接口 (逻辑需微调，目前先放着)
router.post('/test-smtp', verifyToken, isAdmin, configController.testSmtp);

export default router;
