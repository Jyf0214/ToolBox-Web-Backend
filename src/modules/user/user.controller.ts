import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { DatabaseManager } from '../../config/db.config';
import MongoUser, { UserRole } from './user.model';

const JWT_SECRET = process.env.JWT_SECRET || 'toolbox-secret-2026';

/**
 * 用户控制器：处理注册、登录等逻辑
 */
export class UserController {
  /**
   * 用户注册
   */
  public register = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { username, password, email } = req.body;

      if (!username || !password) {
        res.status(400).json({ success: false, message: '用户名和密码为必填项' });
        return;
      }

      const dbType = DatabaseManager.getType();
      if (dbType === 'none') {
        res.status(503).json({ success: false, message: '系统未配置数据库' });
        return;
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      let isFirstAdmin = false;

      // 检查是否已有管理员
      if (dbType === 'mongodb') {
        const adminExists = await MongoUser.findOne({ role: UserRole.ADMIN });
        if (!adminExists) isFirstAdmin = true;
      } else {
        const prisma = DatabaseManager.getPrisma();
        const adminExists = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
        if (!adminExists) isFirstAdmin = true;
      }

      // --- 关键修正：非管理员注册控制 ---
      if (!isFirstAdmin) {
        const dbConfig = DatabaseManager.getType() === 'mongodb' 
          ? await (require('../config/config.model').default).findOne({ key: 'access_config' })
          : await (DatabaseManager.getPrisma()).config.findUnique({ where: { key: 'access_config' } });
        
        const accessConfig = dbConfig ? JSON.parse(dbConfig.value) : { allow_non_admin_registration: true };
        
        if (!accessConfig.allow_non_admin_registration) {
          res.status(403).json({ success: false, message: '系统当前已关闭开放注册，请联系管理员' });
          return;
        }
      }

      try {
        if (dbType === 'mongodb') {
          await MongoUser.create({
            username,
            password: hashedPassword,
            email,
            role: isFirstAdmin ? UserRole.ADMIN : UserRole.USER
          });
        } else {
          const prisma = DatabaseManager.getPrisma();
          await prisma.user.create({
            data: {
              username,
              password: hashedPassword,
              email,
              role: isFirstAdmin ? 'ADMIN' : 'USER'
            }
          });
        }
      } catch (err: any) {
        if (err.message?.includes('unique') || err.code === 11000 || err.code === 'P2002') {
          res.status(409).json({ success: false, message: '用户名或邮箱已存在' });
          return;
        }
        throw err;
      }

      res.status(201).json({
        success: true,
        message: isFirstAdmin ? '首个账户注册成功，已自动设为管理员' : '用户注册成功'
      });

    } catch (error) {
      next(error);
    }
  };

  /**
   * 用户登录
   */
  public login = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { username, password } = req.body;
      const dbType = DatabaseManager.getType();

      let user: any = null;
      if (dbType === 'mongodb') {
        user = await MongoUser.findOne({ username });
      } else if (dbType === 'mysql') {
        user = await DatabaseManager.getPrisma().user.findUnique({ where: { username } });
      }

      if (!user) {
        res.status(401).json({ success: false, message: '用户不存在' });
        return;
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        res.status(401).json({ success: false, message: '密码错误' });
        return;
      }

      // 签发 JWT
      const token = jwt.sign(
        { id: user.id || user._id, username: user.username, role: user.role },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.json({
        success: true,
        message: '登录成功',
        data: {
          token,
          user: {
            username: user.username,
            role: user.role
          }
        }
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * 获取当前用户信息 (鉴权测试)
   */
  public getProfile = async (req: any, res: Response) => {
    res.json({ success: true, data: req.user });
  };

  public getUsers = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const dbType = DatabaseManager.getType();
      let users = [];
      if (dbType === 'mongodb') {
        users = await MongoUser.find({}, '-password');
      } else if (dbType === 'mysql') {
        users = await DatabaseManager.getPrisma().user.findMany({
          select: { id: true, username: true, role: true, createdAt: true, email: true }
        });
      }
      res.json({ success: true, data: users });
    } catch (error) {
      next(error);
    }
  };

  /**
   * 删除用户
   */
  public deleteUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const dbType = DatabaseManager.getType();

      if (dbType === 'mongodb') {
        await MongoUser.findByIdAndDelete(id);
      } else if (dbType === 'mysql') {
        await DatabaseManager.getPrisma().user.delete({ where: { id: Number(id) } });
      }

      res.json({ success: true, message: '用户已删除' });
    } catch (error) {
      next(error);
    }
  };

  /**
   * 修改用户角色
   */
  public updateRole = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { role } = req.body;
      const dbType = DatabaseManager.getType();

      if (dbType === 'mongodb') {
        await MongoUser.findByIdAndUpdate(id, { role });
      } else if (dbType === 'mysql') {
        await DatabaseManager.getPrisma().user.update({
          where: { id: Number(id) },
          data: { role }
        });
      }

      res.json({ success: true, message: '角色已更新' });
    } catch (error) {
      next(error);
    }
  };
}

export const userController = new UserController();
