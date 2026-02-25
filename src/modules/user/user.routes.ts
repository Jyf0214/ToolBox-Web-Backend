import { Router } from 'express';

import { userController } from './user.controller';

const router = Router();

// 定义路由
router.get('/', (req, res, next) => userController.getUsers(req, res, next));
router.post('/', (req, res, next) => userController.createUser(req, res, next));

export default router;
