import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { DatabaseManager } from '../../config/db.config';
import MongoUser, { UserRole, UserStatus } from './user.model';
import MongoLog from '../log/log.model';
import { ConfigController } from '../config/config.controller';

const JWT_SECRET = process.env.JWT_SECRET || 'toolbox-secret-2026';

export class UserController {
  /**
   * 用户注册
   */
  public register = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { username, password, email } = req.body;
      if (!username || !password) {
        res.status(400).json({ success: false, message: '用户名和密码必填' });
        return;
      }

      const usernameLower = username.toLowerCase();
      const dbType = DatabaseManager.getType();
      if (dbType === 'none') {
        res.status(503).json({ success: false, message: '系统未配置数据库' });
        return;
      }

      let isFirstAdmin = false;
      const userCount = dbType === 'mongodb' ? await MongoUser.countDocuments() : await DatabaseManager.getPrisma().user.count();
      if (userCount === 0) isFirstAdmin = true;

        // --- 注册控制逻辑 ---
      if (!isFirstAdmin) {
        const config = await ConfigController.getConfig('access_config');
        const accessConfig = config ? JSON.parse(config) : { 
          allow_non_admin_registration: true,
          max_verified_users: 100,
          reserved_usernames: ['admin', 'system', 'root'],
          allowed_email_domains: [],
          allow_email_alias: false
        };

        // 1. 检查是否允许开放注册
        if (!accessConfig.allow_non_admin_registration) {
          res.status(403).json({ success: false, message: '系统已关闭开放注册' });
          return;
        }

        // 2. 检查保留用户名 (黑名单)
        const reserved = accessConfig.reserved_usernames || [];
        if (reserved.map((n: string) => n.toLowerCase()).includes(usernameLower)) {
          res.status(403).json({ success: false, message: '该用户名已被系统保留' });
          return;
        }

        // 3. 检查邮箱限制
        if (email) {
          const emailParts = email.split('@');
          const account = emailParts[0];
          const domain = emailParts[1]?.toLowerCase();

          // 3.1 检查邮箱别名 (+)
          if (!accessConfig.allow_email_alias && account.includes('+')) {
            res.status(403).json({ success: false, message: '系统禁止使用邮箱别名 (+) 进行注册' });
            return;
          }

          // 3.2 检查域名白名单
          const allowedDomains = (accessConfig.allowed_email_domains || []) as string[];
          if (allowedDomains.length > 0) {
            if (!domain || !allowedDomains.map(d => d.toLowerCase()).includes(domain)) {
              res.status(403).json({ 
                success: false, 
                message: `仅限指定后缀邮箱注册: ${allowedDomains.join(', ')}` 
              });
              return;
            }
          }
        }

        // 4. 检查已验证用户上限
        let verifiedCount = 0;
        if (dbType === 'mongodb') {
          verifiedCount = await MongoUser.countDocuments({ emailVerified: true });
        } else {
          verifiedCount = await DatabaseManager.getPrisma().user.count({ where: { emailVerified: true } });
        }

        if (verifiedCount >= accessConfig.max_verified_users) {
          res.status(429).json({ success: false, message: '已达到验证用户注册上限' });
          return;
        }
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      try {
        if (dbType === 'mongodb') {
          await MongoUser.create({
            username, 
            usernameLower, 
            password: hashedPassword, 
            email,
            role: isFirstAdmin ? UserRole.ADMIN : UserRole.USER
          });
        } else {
          await DatabaseManager.getPrisma().user.create({
            data: {
              username,
              usernameLower,
              password: hashedPassword, 
              email,
              role: isFirstAdmin ? 'ADMIN' : 'USER'
            }
          });
        }
      } catch (err: any) {
        if (err.code === 11000 || err.code === 'P2002') {
          res.status(409).json({ success: false, message: '用户名已被占用' });
          return;
        }
        throw err;
      }

      res.status(201).json({ success: true, message: isFirstAdmin ? '管理员注册成功' : '用户注册成功' });
    } catch (error) { next(error); }
  };

  /**
   * 登录校验
   */
  public login = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { username, password } = req.body;
      const usernameLower = username.toLowerCase();
      const dbType = DatabaseManager.getType();
      let user: any = null;

      if (dbType === 'mongodb') user = await MongoUser.findOne({ usernameLower });
      else user = await DatabaseManager.getPrisma().user.findUnique({ where: { usernameLower } });

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

      res.json({ success: true, data: { token, user: { username: user.username, role: user.role, avatar: user.avatar } } });
    } catch (error) { next(error); }
  };

  /**
   * 获取个人资料
   */
  public getProfile = async (req: any, res: Response) => {
    res.json({ success: true, data: req.user });
  };

  /**
   * 更新个人资料
   */
  public updateProfile = async (req: any, res: Response, next: NextFunction) => {
    try {
      const userId = req.user.id || req.user._id;
      const { avatar } = req.body;
      const dbType = DatabaseManager.getType();

      if (dbType === 'mongodb') {
        await MongoUser.findByIdAndUpdate(userId, { avatar });
      } else {
        await DatabaseManager.getPrisma().user.update({
          where: { id: Number(userId) },
          data: { avatar }
        });
      }
      res.json({ success: true, message: '个人资料已更新' });
    } catch (error) { next(error); }
  };

  /**
   * 切换用户状态
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
   * 删除用户
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
          select: { id: true, username: true, role: true, status: true, createdAt: true, email: true, emailVerified: true, avatar: true }
        });
      }
      res.json({ success: true, data: users });
    } catch (error) { next(error); }
  };
}

export const userController = new UserController();
