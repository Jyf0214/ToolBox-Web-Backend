import { exec } from 'child_process';
import util from 'util';

import { PrismaClient } from '@prisma/client';
import mongoose from 'mongoose';

const execAsync = util.promisify(exec);

export type DbStatus = 'connected' | 'push_failed' | 'disconnected' | 'none';

const maskUrl = (url: string | undefined): string => {
  if (!url) return 'undefined';
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return url.replace(/:([^:@/]+)@/, ':***@');
  }
};

export class DatabaseManager {
  private static prismaInstance: PrismaClient | null = null;
  private static dbType: 'mongodb' | 'mysql' | 'none' = 'none';
  private static status: DbStatus = 'disconnected';

  public static async connect() {
    const url = process.env.DATABASE_URL;
    if (!url) {
      this.status = 'none';
      return;
    }

    const maskedUrl = maskUrl(url);
    if (url.startsWith('mongodb://') || url.startsWith('mongodb+srv://')) {
      console.log(`🔍 正在初始化 MongoDB: ${maskedUrl}`);
      await this.connectMongoDB(url);
      this.dbType = 'mongodb';
    } else if (url.startsWith('mysql://')) {
      console.log(`🔍 正在初始化 MySQL: ${maskedUrl}`);
      await this.connectMySQL();
      this.dbType = 'mysql';
    }
  }

  private static async connectMongoDB(url: string) {
    try {
      mongoose.set('debug', true);
      await mongoose.connect(url);
      
      // MongoDB 自动迁移逻辑
      const User = mongoose.model('User');
      await User.updateMany(
        { usernameLower: { $exists: false } },
        [{ $set: { usernameLower: { $toLower: "$username" } } }]
      );

      this.status = 'connected';
      console.log('✅ MongoDB 连接成功并完成数据自愈');
    } catch (err) {
      this.status = 'disconnected';
      console.error('❌ MongoDB 连接失败:', err);
    }
  }

  /**
   * MySQL 深度迁移自愈：在 db push 之前解决 Schema 冲突
   */
  private static async fixLegacyMySQLData(prisma: PrismaClient) {
    console.log('🔄 正在检查并修复存量数据冲突...');
    try {
      // 1. 尝试添加 usernameLower 列 (如果不存在)
      try {
        await prisma.$executeRawUnsafe(`ALTER TABLE User ADD COLUMN IF NOT EXISTS usernameLower VARCHAR(255) AFTER username`);
      } catch { /* 忽略已存在或不支持语法错误 */ }

      // 2. 关键：将所有存量用户的 usernameLower 填充为小写格式，防止 UNIQUE 约束冲突
      await prisma.$executeRawUnsafe(`UPDATE User SET usernameLower = LOWER(username) WHERE usernameLower IS NULL OR usernameLower = ''`);
      
      // 3. 填充缺失的 avatar 字段默认值
      try {
        await prisma.$executeRawUnsafe(`ALTER TABLE User ADD COLUMN IF NOT EXISTS avatar TEXT AFTER emailVerified`);
      } catch { /* 忽略错误 */ }

      console.log('✨ 存量数据预处理完成，准备同步 Schema');
    } catch (err) {
      console.warn('⚠️  数据预处理提示:', err instanceof Error ? err.message : String(err));
    }
  }

  private static async connectMySQL() {
    const originalUrl = process.env.DATABASE_URL ?? '';
    let secureUrl = originalUrl;
    
    if (originalUrl.startsWith('mysql://') && !originalUrl.includes('sslaccept') && !originalUrl.includes('sslmode')) {
      const separator = originalUrl.includes('?') ? '&' : '?';
      secureUrl = `${originalUrl}${separator}sslaccept=strict`;
    }

    const tryConnectAndSync = async (targetUrl: string) => {
      this.prismaInstance = new PrismaClient({ 
        datasources: { db: { url: targetUrl } },
        log: ['error', 'warn'] 
      });
      await this.prismaInstance.$connect();

      // 执行深度自愈
      await this.fixLegacyMySQLData(this.prismaInstance);

      this.status = 'connected';
      
      try {
        // 带有数据丢失宽容的强制同步
        await execAsync(`npx prisma db push --accept-data-loss --schema ./prisma/schema.prisma`, {
          env: { ...process.env, DATABASE_URL: targetUrl, PRISMA_HIDE_UPDATE_MESSAGE: 'true', PRISMA_NO_HINTS: 'true' }
        });
        console.log('✅ MySQL 结构同步成功');
      } catch (err: unknown) {
        this.status = 'push_failed';
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('⚠️  MySQL 结构增量同步受限 (可能存在复杂约束 drift):', maskUrl(msg));
      }
    };

    try {
      await tryConnectAndSync(secureUrl);
    } catch {
      try {
        if (this.prismaInstance) await this.prismaInstance.$disconnect();
        await tryConnectAndSync(originalUrl);
      } catch {
        this.status = 'disconnected';
        this.prismaInstance = null;
      }
    }
  }

  public static getPrisma() { return this.prismaInstance!; }
  public static getType() { return this.dbType; }
  public static getStatus(): DbStatus { return this.status; }
}
