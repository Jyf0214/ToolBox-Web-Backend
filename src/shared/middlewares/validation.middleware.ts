import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';

/**
 * 请求验证中间件
 */
export function validateRequest(req: Request, res: Response, next: NextFunction): void {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: '请求参数验证失败',
      errors: errors.array().map((err: any) => ({
        field: err.path,
        message: err.msg,
      })),
    });
  }
  next();
}

/**
 * 请求限流中间件 (简单版本)
 */
const requestCount = new Map<string, { count: number; resetTime: number }>();

export function rateLimit(maxRequests: number = 100, windowMs: number = 60000) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const record = requestCount.get(ip);

    if (!record || now > record.resetTime) {
      requestCount.set(ip, { count: 1, resetTime: now + windowMs });
      next();
      return;
    }

    if (record.count >= maxRequests) {
      res.setHeader('Retry-After', Math.ceil((record.resetTime - now) / 1000));
      return res.status(429).json({
        success: false,
        message: '请求过于频繁，请稍后再试',
        status: 429,
      });
    }

    record.count += 1;
    requestCount.set(ip, record);
    next();
  };
}

/**
 * 清理过期的限流记录
 */
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of requestCount.entries()) {
    if (now > record.resetTime) {
      requestCount.delete(ip);
    }
  }
}, 60000);
