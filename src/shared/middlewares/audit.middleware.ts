import { Response, NextFunction } from 'express';
import { DatabaseManager } from '../../config/db.config';
import MongoLog from '../../modules/log/log.model';

/**
 * 记录审计日志的辅助函数
 */
export const recordAuditLog = async (req: any, action: string, module: string, details?: string) => {
  try {
    const dbType = DatabaseManager.getType();
    const logData = {
      action,
      module,
      ip: req.ip || req.headers['x-forwarded-for'],
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
          ip: String(logData.ip),
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
    // 异步记录，不阻塞主流程
    recordAuditLog(req, action, module);
    next();
  };
};
