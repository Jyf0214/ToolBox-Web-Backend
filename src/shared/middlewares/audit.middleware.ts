import { Response, NextFunction } from 'express';
import { DatabaseManager } from '../../config/db.config';
import MongoLog from '../../modules/log/log.model';

/**
 * 从多平台 Header 中动态提取真实客户端 IP
 */
export const getClientIp = (req: any): string => {
  const headers = req.headers;
  
  // 1. 腾讯云 EdgeOne / Vercel 常用
  const realIp = headers['x-real-ip'];
  if (realIp) return String(realIp);

  // 2. Cloudflare
  const cfIp = headers['cf-connecting-ip'];
  if (cfIp) return String(cfIp);

  // 3. 标准转发头
  const forwardedFor = headers['x-forwarded-for'];
  if (forwardedFor) {
    const ips = String(forwardedFor).split(',');
    return ips[0].trim();
  }

  // 4. 回退到直接连接
  return req.ip || req.connection?.remoteAddress || 'unknown';
};

/**
 * 记录审计日志的辅助函数
 */
export const recordAuditLog = async (req: any, action: string, module: string, details?: string) => {
  try {
    const dbType = DatabaseManager.getType();
    const rawUserId = req.user?.id || req.user?._id;
    
    // 构造基础日志对象
    const logData: any = {
      action,
      module,
      ip: getClientIp(req),
      details: details || (req.body ? JSON.stringify(req.body) : undefined),
    };

    if (dbType === 'mongodb') {
      // MongoDB 处理：确保 userId 是有效的 ObjectId 格式字符串或 undefined
      if (rawUserId && typeof rawUserId === 'string' && rawUserId.length === 24) {
        logData.userId = rawUserId;
      }
      await MongoLog.create(logData);
    } else if (dbType === 'mysql') {
      // MySQL 处理：确保 userId 是有效的数字
      const prisma = DatabaseManager.getPrisma();
      const userIdNum = rawUserId ? Number(rawUserId) : null;
      
      await prisma.auditLog.create({
        data: {
          action: logData.action,
          module: logData.module,
          ip: logData.ip,
          userId: (userIdNum && !isNaN(userIdNum)) ? userIdNum : null,
          details: logData.details,
        }
      });
    }
  } catch (err) {
    // 即使审计记录失败也不要阻塞主业务，但打印错误
    console.error('[Audit Log Error]:', err);
  }
};

/**
 * 审计中间件工厂
 */
export const audit = (action: string, module: string) => {
  return (req: any, _res: Response, next: NextFunction) => {
    // 异步记录日志，不阻塞响应
    recordAuditLog(req, action, module).catch(err => {
      console.error('[Audit Middleware Error]:', err);
    });
    next();
  };
};
