import { Request, Response, NextFunction } from 'express';
import { DatabaseManager } from '../../config/db.config';
import MongoLog from './log.model';

export class LogController {
  public getLogs = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dbType = DatabaseManager.getType();
      let logs = [];

      if (dbType === 'mongodb') {
        logs = await MongoLog.find().sort({ createdAt: -1 }).limit(100);
      } else if (dbType === 'mysql') {
        logs = await DatabaseManager.getPrisma().auditLog.findMany({
          orderBy: { createdAt: 'desc' },
          take: 100,
          include: { user: { select: { username: true } } }
        });
      }

      res.json({ success: true, data: logs });
    } catch (error) {
      next(error);
    }
  };
}

export const logController = new LogController();
