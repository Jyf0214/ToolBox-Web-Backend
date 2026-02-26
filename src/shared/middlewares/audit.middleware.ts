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
  return req.ip || req.connection.remoteAddress || 'unknown';
};

/**
 * 记录审计日志的辅助函数
 */
export const recordAuditLog = async (req: any, action: string, module: string, details?: string) => {
  try {
    const dbType = DatabaseManager.getType();
    const logData = {
      action,
      module,
      ip: getClientIp(req), // 使用精准提取逻辑
      userId: req.user?.id || req.user?._id,
      details: details || JSON.stringify(req.body),
    };

    if (dbType === 'mongodb') {
      await MongoLog.create(logData);
    } else if (dbType === 'mysql') {
      const prisma = DatabaseManager.getPrisma();
      await prisma.auditLog.create({
        data: {
          action: logData.action,
          module: logData.module,
          ip: logData.ip,
          userId: logData.userId ? Number(logData.userId) : null,
          details: logData.details,
        }
      });
    }
  } catch (err) {
    console.error('Audit Log Error:', err);
  }
};

/**
 * 审计中间件工厂
 */
export const audit = (action: string, module: string) => {
  return (req: any, _res: Response, next: NextFunction) => {
    // 记录行为
    recordAuditLog(req, action, module);
    next();
  };
};
