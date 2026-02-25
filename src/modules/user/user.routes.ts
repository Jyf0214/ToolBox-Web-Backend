import { Router } from 'express';
import { userController } from './user.controller';

const router = Router();

// 定义路由
router.get('/', userController.getUsers);
router.post('/', userController.createUser);

export default router;
