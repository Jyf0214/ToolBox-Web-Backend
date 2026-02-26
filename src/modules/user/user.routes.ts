import { Router } from 'express';
import { userController } from './user.controller';
import { verifyToken } from '../../shared/middlewares/auth.middleware';

const router = Router();

// 公开接口
router.post('/register', (req, res, next) => userController.register(req, res, next));
router.post('/login', (req, res, next) => userController.login(req, res, next));

// 需登录接口
router.get('/profile', verifyToken, (req, res) => userController.getProfile(req, res));
router.get('/', verifyToken, (req, res, next) => userController.getUsers(req, res, next));

export default router;
