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
      this.status = 'connected';
      console.log('✅ MongoDB 连接成功');
    } catch (err) {
      this.status = 'disconnected';
      console.error('❌ MongoDB 连接失败:', err);
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
      this.prismaInstance = new PrismaClient({ datasources: { db: { url: targetUrl } } });
      await this.prismaInstance.$connect();
      this.status = 'connected';
      
      try {
        await execAsync(`npx prisma db push --accept-data-loss --schema ./prisma/schema.prisma`, {
          env: { ...process.env, DATABASE_URL: targetUrl, PRISMA_HIDE_UPDATE_MESSAGE: 'true' }
        });
      } catch (err: unknown) {
        this.status = 'push_failed';
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('⚠️  结构同步失败:', maskUrl(msg));
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
