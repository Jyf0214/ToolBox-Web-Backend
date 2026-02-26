import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'toolbox-secret-2026';

/**
 * 验证 Token 中间件
 */
export const verifyToken = (req: any, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    res.status(401).json({ success: false, message: '未提供认证凭据' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(403).json({ success: false, message: '无效或过期的 Token' });
  }
};

/**
 * 管理员权限校验中间件
 */
export const isAdmin = (req: any, res: Response, next: NextFunction) => {
  if (req.user && req.user.role === 'ADMIN') {
    next();
  } else {
    res.status(403).json({ success: false, message: '权限不足，需要管理员权限' });
  }
};
