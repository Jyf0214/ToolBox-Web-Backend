import { Router } from 'express';

import { userController } from './user.controller';

const router = Router();

// 定义路由
router.get('/', (req, res, next) => userController.getUsers(req, res, next));
router.post('/register', (req, res, next) => userController.register(req, res, next));

export default router;
