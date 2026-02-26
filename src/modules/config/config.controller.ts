import { Request, Response, NextFunction } from 'express';
import nodemailer from 'nodemailer';
import { DatabaseManager } from '../../config/db.config';
import MongoConfig from './config.model';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  secure: boolean;
}

export class ConfigController {
  private static KEY_SMTP = 'smtp_config';

  /**
   * 获取 SMTP 配置
   */
  public getSmtpConfig = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const dbType = DatabaseManager.getType();
      let configValue = null;

      if (dbType === 'mongodb') {
        const doc = await MongoConfig.findOne({ key: ConfigController.KEY_SMTP });
        configValue = doc?.value;
      } else if (dbType === 'mysql') {
        const doc = await DatabaseManager.getPrisma().config.findUnique({
          where: { key: ConfigController.KEY_SMTP }
        });
        configValue = doc?.value;
      }

      if (!configValue) {
        res.json({ success: true, data: null });
        return;
      }

      const config: SmtpConfig = JSON.parse(configValue);
      // 脱敏处理
      if (config.pass) config.pass = '********';

      res.json({ success: true, data: config });
    } catch (error) {
      next(error);
    }
  };

  /**
   * 更新 SMTP 配置
   */
  public updateSmtpConfig = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const config: SmtpConfig = req.body;
      const dbType = DatabaseManager.getType();
      const valueStr = JSON.stringify(config);

      if (dbType === 'mongodb') {
        await MongoConfig.findOneAndUpdate(
          { key: ConfigController.KEY_SMTP },
          { value: valueStr },
          { upsert: true, new: true }
        );
      } else if (dbType === 'mysql') {
        const prisma = DatabaseManager.getPrisma();
        await prisma.config.upsert({
          where: { key: ConfigController.KEY_SMTP },
          update: { value: valueStr },
          create: { key: ConfigController.KEY_SMTP, value: valueStr }
        });
      }

      res.json({ success: true, message: 'SMTP 配置已保存' });
    } catch (error) {
      next(error);
    }
  };

  /**
   * 测试 SMTP 连接
   */
  public testSmtp = async (req: Request, res: Response) => {
    try {
      const config: SmtpConfig = req.body;
      
      // 如果密码是脱敏的，说明没改密码，尝试从数据库获取原密码
      if (config.pass === '********') {
        const dbType = DatabaseManager.getType();
        let dbValue = null;
        if (dbType === 'mongodb') {
          const doc = await MongoConfig.findOne({ key: ConfigController.KEY_SMTP });
          dbValue = doc?.value;
        } else if (dbType === 'mysql') {
          const doc = await DatabaseManager.getPrisma().config.findUnique({ where: { key: ConfigController.KEY_SMTP } });
          dbValue = doc?.value;
        }
        if (dbValue) {
          const oldConfig = JSON.parse(dbValue);
          config.pass = oldConfig.pass;
        }
      }

      const transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
          user: config.user,
          pass: config.pass,
        },
      });

      // 验证连接
      await transporter.verify();

      res.json({ success: true, message: 'SMTP 连接测试成功！' });
    } catch (error: any) {
      res.status(500).json({ success: false, message: `连接测试失败: ${error.message}` });
    }
  };
}

export const configController = new ConfigController();
