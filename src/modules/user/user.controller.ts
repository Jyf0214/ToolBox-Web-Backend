import type { Request, Response, NextFunction } from 'express';

/**
 * 用户控制器
 */
export class UserController {
  /**
   * 获取所有用户 (示例)
   */
  public getUsers(_req: Request, res: Response, next: NextFunction) {
    try {
      // 模拟返回数据
      res.json({
        success: true,
        data: [{ id: 1, name: '张三' }, { id: 2, name: '李四' }]
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * 创建用户 (示例)
   */
  public createUser(req: Request, res: Response, next: NextFunction) {
    try {
      const { name } = req.body as { name: string };
      res.status(201).json({
        success: true,
        data: { id: Date.now(), name }
      });
    } catch (error) {
      next(error);
    }
  }
}

export const userController = new UserController();
