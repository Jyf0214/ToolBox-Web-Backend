import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { DatabaseManager } from '../../config/db.config';
import MongoUser, { UserRole, UserStatus } from './user.model';
import MongoLog from '../log/log.model';

const JWT_SECRET = process.env.JWT_SECRET || 'toolbox-secret-2026';

export class UserController {
  /**
   * 用户注册：第一个账户必定为管理员
   */
  public register = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { username, password, email } = req.body;
      if (!username || !password) {
        res.status(400).json({ success: false, message: '用户名和密码必填' });
        return;
      }

      const dbType = DatabaseManager.getType();
      let isFirstAdmin = false;

      if (dbType === 'mongodb') {
        const count = await MongoUser.countDocuments();
        if (count === 0) isFirstAdmin = true;
      } else {
        const count = await DatabaseManager.getPrisma().user.count();
        if (count === 0) isFirstAdmin = true;
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      try {
        if (dbType === 'mongodb') {
          await MongoUser.create({
            username, password: hashedPassword, email,
            role: isFirstAdmin ? UserRole.ADMIN : UserRole.USER
          });
        } else {
          await DatabaseManager.getPrisma().user.create({
            data: {
              username, password: hashedPassword, email,
              role: isFirstAdmin ? 'ADMIN' : 'USER'
            }
          });
        }
      } catch (err: any) {
        if (err.code === 11000 || err.code === 'P2002') {
          res.status(409).json({ success: false, message: '用户名已存在' });
          return;
        }
        throw err;
      }

      res.status(201).json({ success: true, message: isFirstAdmin ? '管理员注册成功' : '用户注册成功' });
    } catch (error) { next(error); }
  };

  /**
   * 登录校验：增加状态检查
   */
  public login = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { username, password } = req.body;
      const dbType = DatabaseManager.getType();
      let user: any = null;

      if (dbType === 'mongodb') user = await MongoUser.findOne({ username });
      else user = await DatabaseManager.getPrisma().user.findUnique({ where: { username } });

      if (!user) {
        res.status(401).json({ success: false, message: '用户不存在' });
        return;
      }

      if (user.status === 'BANNED') {
        res.status(403).json({ success: false, message: '您的账号已被封禁' });
        return;
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        res.status(401).json({ success: false, message: '密码错误' });
        return;
      }

      const token = jwt.sign(
        { id: user.id || user._id, username: user.username, role: user.role },
        JWT_SECRET, { expiresIn: '7d' }
      );

      res.json({ success: true, data: { token, user: { username: user.username, role: user.role } } });
    } catch (error) { next(error); }
  };

  /**
   * 切换用户状态 (封禁/激活)
   */
  public toggleStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const dbType = DatabaseManager.getType();
      let user: any = null;

      if (dbType === 'mongodb') user = await MongoUser.findById(id);
      else user = await DatabaseManager.getPrisma().user.findUnique({ where: { id: Number(id) } });

      if (!user) return res.status(404).json({ success: false, message: '未找到用户' });
      if (user.role === 'ADMIN') return res.status(403).json({ success: false, message: '无法对管理员进行此操作' });

      const newStatus = user.status === 'BANNED' ? 'ACTIVE' : 'BANNED';

      if (dbType === 'mongodb') await MongoUser.findByIdAndUpdate(id, { status: newStatus });
      else await DatabaseManager.getPrisma().user.update({ where: { id: Number(id) }, data: { status: newStatus as any } });

      res.json({ success: true, message: `用户已${newStatus === 'BANNED' ? '封禁' : '激活'}` });
    } catch (error) { next(error); }
  };

  /**
   * 删除用户：禁止删除管理员
   */
  public deleteUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const dbType = DatabaseManager.getType();
      let user: any = null;

      if (dbType === 'mongodb') user = await MongoUser.findById(id);
      else user = await DatabaseManager.getPrisma().user.findUnique({ where: { id: Number(id) } });

      if (user?.role === 'ADMIN') return res.status(403).json({ success: false, message: '无法删除管理员' });

      if (dbType === 'mongodb') await MongoUser.findByIdAndDelete(id);
      else await DatabaseManager.getPrisma().user.delete({ where: { id: Number(id) } });

      res.json({ success: true, message: '用户已删除' });
    } catch (error) { next(error); }
  };

  /**
   * 获取用户详细用量统计
   */
  public getUserUsage = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const dbType = DatabaseManager.getType();
      let stats = { uploadCount: 0, convertCount: 0, loginCount: 0 };

      if (dbType === 'mongodb') {
        stats.uploadCount = await MongoLog.countDocuments({ userId: id, action: 'UPLOAD_IMAGE' });
        stats.convertCount = await MongoLog.countDocuments({ userId: id, module: 'CONVERT' });
        stats.loginCount = await MongoLog.countDocuments({ userId: id, action: 'LOGIN' });
      } else {
        const prisma = DatabaseManager.getPrisma();
        stats.uploadCount = await prisma.auditLog.count({ where: { userId: Number(id), action: 'UPLOAD_IMAGE' } });
        stats.convertCount = await prisma.auditLog.count({ where: { userId: Number(id), module: 'CONVERT' } });
        // 注意：目前登录没挂 audit，可以统计 LOGIN action (需在 login 方法添加记录)
      }

      res.json({ success: true, data: stats });
    } catch (error) { next(error); }
  };

  public getUsers = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const dbType = DatabaseManager.getType();
      let users = [];
      if (dbType === 'mongodb') {
        users = await MongoUser.find({}, '-password');
      } else if (dbType === 'mysql') {
        users = await DatabaseManager.getPrisma().user.findMany({
          select: { id: true, username: true, role: true, status: true, createdAt: true, email: true }
        });
      }
      res.json({ success: true, data: users });
    } catch (error) { next(error); }
  };

  public getProfile = async (req: any, res: Response) => {
    res.json({ success: true, data: req.user });
  };
}

export const userController = new UserController();
