import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { DatabaseManager } from '../../config/db.config';
import MongoUser, { UserRole } from './user.model';

/**
 * 用户控制器：处理注册、登录等逻辑
 */
export class UserController {
  /**
   * 用户注册
   * 逻辑：第一个注册的账户自动设为管理员
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
        res.status(503).json({ success: false, message: '系统未配置数据库，暂时无法注册' });
        return;
      }

      // 加密密码
      const hashedPassword = await bcrypt.hash(password, 10);
      let isFirstAdmin = false;

      // --- 1. 检查是否存在管理员 (智能适配数据库) ---
      if (dbType === 'mongodb') {
        const adminExists = await MongoUser.findOne({ role: UserRole.ADMIN });
        if (!adminExists) isFirstAdmin = true;
      } else {
        const prisma = DatabaseManager.getPrisma();
        const adminExists = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
        if (!adminExists) isFirstAdmin = true;
      }

      const role = isFirstAdmin ? 'ADMIN' : 'USER';

      // --- 2. 创建用户 ---
      let newUser;
      try {
        if (dbType === 'mongodb') {
          newUser = await MongoUser.create({
            username,
            password: hashedPassword,
            email,
            role: isFirstAdmin ? UserRole.ADMIN : UserRole.USER
          });
        } else {
          const prisma = DatabaseManager.getPrisma();
          newUser = await prisma.user.create({
            data: {
              username,
              password: hashedPassword,
              email,
              role: 'ADMIN' as any // Prisma enum 处理
            }
          });
          // 修正 Prisma Role
          if (!isFirstAdmin) {
            await prisma.user.update({
              where: { id: (newUser as any).id },
              data: { role: 'USER' }
            });
          }
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
        message: isFirstAdmin ? '首个账户注册成功，已自动设为管理员' : '用户注册成功',
        data: {
          username: (newUser as any).username,
          role: (newUser as any).role
        }
      });

    } catch (error) {
      next(error);
    }
  };

  /**
   * 示例：获取用户列表 (仅供调试)
   */
  public getUsers = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const dbType = DatabaseManager.getType();
      let users = [];

      if (dbType === 'mongodb') {
        users = await MongoUser.find({}, '-password');
      } else if (dbType === 'mysql') {
        users = await DatabaseManager.getPrisma().user.findMany({
          select: { id: true, username: true, role: true, createdAt: true }
        });
      }

      res.json({ success: true, data: users });
    } catch (error) {
      next(error);
    }
  };
}

export const userController = new UserController();
