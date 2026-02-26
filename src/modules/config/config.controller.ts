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
  { key: 'max_verified_users', label: '最大注册用户数', type: 'number', group: '访问控制', defaultValue: 100, rules: [{ required: true, message: '必填' }] },
    { key: 'allowed_email_domains', label: '允许的邮箱域名', type: 'multi-select', group: '访问控制', 
      defaultValue: ['gmail.com', 'outlook.com', 'qq.com', '163.com', 'icloud.com'],
      options: [
        { label: 'gmail.com', value: 'gmail.com' },
        { label: 'outlook.com', value: 'outlook.com' },
        { label: 'qq.com', value: 'qq.com' },
        { label: '163.com', value: '163.com' }
      ],
      tooltip: '仅允许这些后缀的邮箱注册，留空则不限制'
    },
    { key: 'allow_email_alias', label: '允许邮箱别名 (+)', type: 'switch', group: '访问控制', defaultValue: false, tooltip: '关闭后将禁止如 user+extra@domain.com 形式的邮箱注册' },
    { 
      key: 'reserved_usernames', label: '保留用户名', type: 'multi-select', group: '访问控制', 
      defaultValue: ['admin', 'administrator', 'system', 'official', 'root', 'support', 'toolbox'],
    options: [
      { label: 'admin', value: 'admin' },
      { label: 'system', value: 'system' },
      { label: 'official', value: 'official' },
      { label: 'support', value: 'support' }
    ],
    tooltip: '这些用户名仅限首位管理员使用，普通用户注册时将被拦截'
  },
  { key: 'free_user_quota', label: '免费用户额度', type: 'number', group: '额度与单位', defaultValue: 10 },
  { key: 'guest_user_quota', label: '游客用户额度', type: 'number', group: '额度与单位', defaultValue: 3 },
  { 
    key: 'quota_unit', label: '额度单位', type: 'select', group: '额度与单位', defaultValue: 'calls/day',
    options: [{ label: '次数/天', value: 'calls/day' }, { label: 'MB/天', value: 'MB/day' }]
  },
  { key: 'smtp_host', label: 'SMTP 服务器', type: 'text', group: '邮件服务', defaultValue: '', placeholder: 'smtp.example.com' },
  { key: 'smtp_port', label: '端口', type: 'number', group: '邮件服务', defaultValue: 465 },
  { key: 'smtp_user', label: '发件账号', type: 'text', group: '邮件服务', defaultValue: '' },
  { key: 'smtp_pass', label: '授权码/密码', type: 'password', group: '邮件服务', defaultValue: '' },
  { key: 'smtp_secure', label: '启用 SSL', type: 'switch', group: '邮件服务', defaultValue: true },
  { 
    key: 'guest_features', label: '游客可用功能', type: 'multi-select', group: '权限白名单', defaultValue: ['convert'],
    options: [{ label: '文档转换', value: 'convert' }, { label: 'Markdown', value: 'markdown' }]
  },
  { 
    key: 'free_features', label: '免费用户功能', type: 'multi-select', group: '权限白名单', defaultValue: ['convert', 'markdown'],
    options: [{ label: '文档转换', value: 'convert' }, { label: 'Markdown', value: 'markdown' }]
  }
];

export class ConfigController {
  /**
   * 暴露静态方法供其他模块 (如 UserController) 调用
   */
  public static getConfig = async (key: string) => {
    const dbType = DatabaseManager.getType();
    let value = null;
    if (dbType === 'mongodb') {
      const doc = await MongoConfig.findOne({ key });
      value = doc?.value;
    } else if (dbType === 'mysql') {
      const doc = await DatabaseManager.getPrisma().config.findUnique({ where: { key } });
      value = doc?.value;
    }
    try {
      return value ? JSON.parse(value) : null;
    } catch {
      return value;
    }
  };

  public getSchema = async (_req: Request, res: Response) => {
    res.json({ success: true, data: SYSTEM_CONFIG_SCHEMA });
  };

  public getAllConfigs = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const dbType = DatabaseManager.getType();
      let dbConfigs: any[] = [];
      if (dbType === 'mongodb') dbConfigs = await MongoConfig.find({});
      else if (dbType === 'mysql') dbConfigs = await DatabaseManager.getPrisma().config.findMany();

      const values: Record<string, any> = {};
      SYSTEM_CONFIG_SCHEMA.forEach(item => { values[item.key] = item.defaultValue; });
      dbConfigs.forEach(c => {
        try { values[c.key] = JSON.parse(c.value); } catch { values[c.key] = c.value; }
      });
      SYSTEM_CONFIG_SCHEMA.filter(s => s.type === 'password').forEach(s => {
        if (values[s.key]) values[s.key] = '********';
      });
      res.json({ success: true, data: values });
    } catch (error) { next(error); }
  };

  public updateConfigs = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updates = req.body;
      const dbType = DatabaseManager.getType();
      for (const [key, value] of Object.entries(updates)) {
        const schema = SYSTEM_CONFIG_SCHEMA.find(s => s.key === key);
        if (!schema) continue;
        if (schema.type === 'password' && value === '********') continue;
        const valueStr = JSON.stringify(value);
        if (dbType === 'mongodb') {
          await MongoConfig.findOneAndUpdate({ key }, { value: valueStr }, { upsert: true });
        } else if (dbType === 'mysql') {
          await DatabaseManager.getPrisma().config.upsert({
            where: { key }, update: { value: valueStr }, create: { key, value: valueStr }
          });
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
        pass = await ConfigController.getConfig('smtp_pass');
      }
      const transporter = nodemailer.createTransport({
        host: values.smtp_host, port: values.smtp_port, secure: values.smtp_secure,
        auth: { user: values.smtp_user, pass: pass }
      });
      await transporter.verify();
      res.json({ success: true, message: 'SMTP 连接成功' });
    } catch (error: any) {
      res.status(500).json({ success: false, message: `测试失败: ${error.message}` });
    }
  };
}

export const configController = new ConfigController();
