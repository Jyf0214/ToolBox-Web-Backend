import { Request, Response, NextFunction } from 'express';

/**
 * 前后端私有通信校验中间件
 * 目的：防止绕过前端直接攻击后端 API
 */
export const verifyInternalKey = (req: Request, res: Response, next: NextFunction) => {
  const serverKey = process.env.FRONTEND_API_KEY;

  // 如果后端未配置密钥，则默认放行所有请求 (兼容模式)
  if (!serverKey || serverKey.trim() === '') {
    return next();
  }

  // 检查请求头中的私有密钥
  const clientKey = req.headers['x-internal-api-key'];

  if (clientKey === serverKey) {
    next();
  } else {
    // 密钥不匹配或缺失，拒绝访问
    res.status(403).json({
      success: false,
      message: 'Access Denied: 仅限受信任的前端网关访问',
      status: 403
    });
  }
};
