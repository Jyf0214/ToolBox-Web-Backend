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

export interface AccessConfig {
  allow_non_admin_registration: boolean;
  allow_guest_access: boolean;
  free_user_quota: number;
  guest_user_quota: number;
  quota_unit: string;
  guest_feature_whitelist: string[];
  free_tier_features: string[];
}

export class ConfigController {
  private static KEY_SMTP = 'smtp_config';
  private static KEY_ACCESS = 'access_config';

  private static getConfig = async (key: string) => {
    const dbType = DatabaseManager.getType();
    let value = null;
    if (dbType === 'mongodb') {
      const doc = await MongoConfig.findOne({ key });
      value = doc?.value;
    } else if (dbType === 'mysql') {
      const doc = await DatabaseManager.getPrisma().config.findUnique({ where: { key } });
      value = doc?.value;
    }
    return value ? JSON.parse(value) : null;
  };

  private static setConfig = async (key: string, value: any) => {
    const dbType = DatabaseManager.getType();
    const valueStr = JSON.stringify(value);
    if (dbType === 'mongodb') {
      await MongoConfig.findOneAndUpdate({ key }, { value: valueStr }, { upsert: true });
    } else if (dbType === 'mysql') {
      await DatabaseManager.getPrisma().config.upsert({
        where: { key },
        update: { value: valueStr },
        create: { key, value: valueStr }
      });
    }
  };

  public getSmtpConfig = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const config = await ConfigController.getConfig(ConfigController.KEY_SMTP);
      if (config && config.pass) config.pass = '********';
      res.json({ success: true, data: config });
    } catch (error) { next(error); }
  };

  public updateSmtpConfig = async (req: Request, res: Response, next: NextFunction) => {
    try {
      await ConfigController.setConfig(ConfigController.KEY_SMTP, req.body);
      res.json({ success: true, message: 'SMTP 配置已保存' });
    } catch (error) { next(error); }
  };

  /**
   * 获取访问与额度配置
   */
  public getAccessConfig = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      let config = await ConfigController.getConfig(ConfigController.KEY_ACCESS);
      // 默认值
      if (!config) {
        config = {
          allow_non_admin_registration: true,
          allow_guest_access: true,
          free_user_quota: 10,
          guest_user_quota: 3,
          quota_unit: 'calls/day',
          guest_feature_whitelist: ['convert'],
          free_tier_features: ['convert', 'markdown']
        };
      }
      res.json({ success: true, data: config });
    } catch (error) { next(error); }
  };

  /**
   * 更新访问与额度配置
   */
  public updateAccessConfig = async (req: Request, res: Response, next: NextFunction) => {
    try {
      await ConfigController.setConfig(ConfigController.KEY_ACCESS, req.body);
      res.json({ success: true, message: '访问配置已保存' });
    } catch (error) { next(error); }
  };

  public testSmtp = async (req: Request, res: Response) => {
    try {
      const config: SmtpConfig = req.body;
      if (config.pass === '********') {
        const old = await ConfigController.getConfig(ConfigController.KEY_SMTP);
        if (old) config.pass = old.pass;
      }
      const transporter = nodemailer.createTransport({
        host: config.host, port: config.port, secure: config.secure,
        auth: { user: config.user, pass: config.pass }
      });
      await transporter.verify();
      res.json({ success: true, message: 'SMTP 连接成功' });
    } catch (error: any) {
      res.status(500).json({ success: false, message: `测试失败: ${error.message}` });
    }
  };
}

export const configController = new ConfigController();
