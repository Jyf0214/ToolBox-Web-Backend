import { Router } from 'express';
import { userController } from './user.controller';
import { verifyToken, isAdmin } from '../../shared/middlewares/auth.middleware';
import { audit } from '../../shared/middlewares/audit.middleware';

const router = Router();

// 公开接口
router.post('/register', (req, res, next) => userController.register(req, res, next));
router.post('/login', (req, res, next) => userController.login(req, res, next));

// 个人资料 (用户自管理)
router.get('/profile', verifyToken, (req, res) => userController.getProfile(req, res));
router.patch('/profile', verifyToken, audit('UPDATE_PROFILE', 'USER'), (req, res, next) => userController.updateProfile(req, res, next));

// 管理员专用接口
router.get('/', verifyToken, isAdmin, (req, res, next) => userController.getUsers(req, res, next));
router.get('/:id/usage', verifyToken, isAdmin, (req, res, next) => userController.getUserUsage(req, res, next));
router.patch('/:id/status', verifyToken, isAdmin, audit('TOGGLE_USER_STATUS', 'USER'), (req, res, next) => userController.toggleStatus(req, res, next));
router.delete('/:id', verifyToken, isAdmin, audit('DELETE_USER', 'USER'), (req, res, next) => userController.deleteUser(req, res, next));

export default router;
