import { Request, Response, NextFunction } from 'express';
import nodemailer from 'nodemailer';
import { DatabaseManager } from '../../config/db.config';
import MongoConfig from './config.model';

export type ConfigType = 'text' | 'password' | 'number' | 'switch' | 'select' | 'multi-select';

export interface ConfigSchemaItem {
  key: string;
  label: string;
  type: ConfigType;
  group: string;
  defaultValue: any;
  options?: { label: string; value: any }[];
  rules?: { required?: boolean; min?: number; max?: number; pattern?: string; message?: string }[];
  placeholder?: string;
  tooltip?: string;
}

const SYSTEM_CONFIG_SCHEMA: ConfigSchemaItem[] = [
  { key: 'allow_non_admin_registration', label: '开放用户注册', type: 'switch', group: '访问控制', defaultValue: true },
  { key: 'allow_guest_access', label: '允许游客使用', type: 'switch', group: '访问控制', defaultValue: true },
  { key: 'max_verified_users', label: '最大注册用户数', type: 'number', group: '访问控制', defaultValue: 100 },
  { key: 'allowed_email_domains', label: '允许的邮箱域名', type: 'multi-select', group: '访问控制', defaultValue: [] },
  { key: 'allow_email_alias', label: '允许邮箱别名 (+)', type: 'switch', group: '访问控制', defaultValue: false },
  { key: 'enforce_qq_numeric_only', label: 'QQ 邮箱强制纯数字', type: 'switch', group: '访问控制', defaultValue: true },
  { key: 'reserved_usernames', label: '保留用户名', type: 'multi-select', group: '访问控制', defaultValue: ['admin', 'system'] },
  { key: 'smtp_host', label: 'SMTP 服务器', type: 'text', group: '邮件服务', defaultValue: '' },
  { key: 'smtp_port', label: '端口', type: 'number', group: '邮件服务', defaultValue: 465 },
  { key: 'smtp_user', label: '发件账号', type: 'text', group: '邮件服务', defaultValue: '' },
  { key: 'smtp_pass', label: '授权码/密码', type: 'password', group: '邮件服务', defaultValue: '' },
  { key: 'smtp_secure', label: '启用 SSL', type: 'switch', group: '邮件服务', defaultValue: true },
  { key: 'free_user_quota', label: '免费用户额度', type: 'number', group: '额度管理', defaultValue: 10 },
  { key: 'guest_user_quota', label: '游客用户额度', type: 'number', group: '额度管理', defaultValue: 3 },
  { key: 'quota_unit', label: '额度单位', type: 'select', group: '额度管理', defaultValue: 'calls/day' },
  { key: 'guest_features', label: '游客可用功能', type: 'multi-select', group: '功能权限', defaultValue: ['convert'] },
  { key: 'free_features', label: '免费用户功能', type: 'multi-select', group: '功能权限', defaultValue: ['convert', 'markdown'] }
];

export class ConfigController {
  public static getConfig = async (key: string) => {
    const dbType = DatabaseManager.getType();
    let value = null;
    try {
      if (dbType === 'mongodb') {
        const doc = await MongoConfig.findOne({ key });
        value = doc?.value;
      } else if (dbType === 'mysql') {
        const prisma = DatabaseManager.getPrisma();
        if (prisma) {
          const doc = await prisma.config.findUnique({ where: { key } });
          value = doc?.value;
        }
      }
      if (value === null || value === undefined) {
        return SYSTEM_CONFIG_SCHEMA.find(s => s.key === key)?.defaultValue ?? null;
      }
      return JSON.parse(value);
    } catch {
      return value;
    }
  };

  public getSchema = async (_req: Request, res: Response) => {
    res.json({ success: true, data: SYSTEM_CONFIG_SCHEMA });
  };

  public getHealth = async (_req: Request, res: Response) => {
    const mem = process.memoryUsage();
    res.json({
      success: true,
      data: {
        dbStatus: DatabaseManager.getStatus(),
        dbType: DatabaseManager.getType(),
        nodeVersion: process.version,
        uptime: Math.floor(process.uptime()),
        memory: {
          rss: Math.round(mem.rss / 1024 / 1024) + ' MB',
          heapTotal: Math.round(mem.heapTotal / 1024 / 1024) + ' MB'
        },
        timestamp: new Date().toISOString()
      }
    });
  };

  public getAllConfigs = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dbType = DatabaseManager.getType();
      let dbConfigs: any[] = [];
      if (dbType === 'mongodb') dbConfigs = await MongoConfig.find({});
      else if (dbType === 'mysql') {
        const prisma = DatabaseManager.getPrisma();
        if (prisma) dbConfigs = await prisma.config.findMany();
      }

      const values: Record<string, any> = {};
      SYSTEM_CONFIG_SCHEMA.forEach(item => { values[item.key] = item.defaultValue; });
      dbConfigs.forEach(c => {
        try { values[c.key] = JSON.parse(c.value); } catch { values[c.key] = c.value; }
      });
      console.log(`[Config] 成功下发配置列表，键数: ${Object.keys(values).length}`);
      res.json({ success: true, data: values });
    } catch (error) { next(error); }
  };

  public updateConfigs = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updates = req.body;
      const dbType = DatabaseManager.getType();
      for (const [key, value] of Object.entries(updates)) {
        const valueStr = JSON.stringify(value);
        if (dbType === 'mongodb') {
          await MongoConfig.findOneAndUpdate({ key }, { value: valueStr }, { upsert: true });
        } else if (dbType === 'mysql') {
          const prisma = DatabaseManager.getPrisma();
          if (prisma) {
            await prisma.config.upsert({ where: { key }, update: { value: valueStr }, create: { key, value: valueStr } });
          }
        }
      }
      res.json({ success: true, message: '配置已更新' });
    } catch (error) { next(error); }
  };

  public testSmtp = async (req: Request, res: Response) => {
    try {
      const values = req.body;
      let pass = values.smtp_pass;
      if (pass === '********') {
        const dbPass = await ConfigController.getConfig('smtp_pass');
        pass = dbPass;
      }

      console.log(`[SMTP Test] 正在尝试连接: ${values.smtp_host}:${values.smtp_port}, User: ${values.smtp_user}`);

      const transporter = nodemailer.createTransport({
        host: values.smtp_host,
        port: Number(values.smtp_port),
        secure: values.smtp_secure === true || values.smtp_secure === 'true',
        auth: { user: values.smtp_user, pass: pass },
        connectionTimeout: 10000
      });

      await transporter.verify();
      res.json({ success: true, message: 'SMTP 连接成功' });
    } catch (error: any) {
      console.error('[SMTP Test Error]:', error);
      res.status(500).json({ success: false, message: `测试失败: ${error.message}` });
    }
  };
}

export const configController = new ConfigController();
