import mongoose from 'mongoose';
import { PrismaClient } from '@prisma/client';

/**
 * 数据库适配器配置 (Prisma 6.x 智能适配版)
 */
export class DatabaseManager {
  private static prismaInstance: PrismaClient | null = null;
  private static dbType: 'mongodb' | 'mysql' | 'none' = 'none';

  /**
   * 初始化数据库连接 (智能判断)
   */
  public static async connect() {
    const url = process.env.DATABASE_URL;

    if (!url) {
      console.log('⚠️  未检测到 DATABASE_URL，将运行在无数据库模式');
      return;
    }

    if (url.startsWith('mongodb://') || url.startsWith('mongodb+srv://')) {
      console.log('🔍 检测到 MongoDB 连接字符串，正在初始化 Mongoose...');
      await this.connectMongoDB(url);
      this.dbType = 'mongodb';
    } else if (url.startsWith('mysql://')) {
      console.log('🔍 检测到 MySQL 连接字符串，正在初始化 Prisma 6.x...');
      await this.connectMySQL();
      this.dbType = 'mysql';
    } else {
      console.error('❌ 不支持的数据库协议类型:', url.split(':')[0]);
      console.log('⚠️  将以降级模式运行 (无数据库)');
    }
  }

  private static async connectMongoDB(url: string) {
    try {
      await mongoose.connect(url);
      console.log('✅ MongoDB 连接成功');
    } catch (err) {
      console.error('❌ MongoDB 连接失败:', err);
    }
  }

  private static async connectMySQL() {
    const originalUrl = process.env.DATABASE_URL || '';
    let secureUrl = originalUrl;
    
    // 🛡️ 步骤 1：准备安全链接
    if (originalUrl.startsWith('mysql://') && !originalUrl.includes('sslaccept') && !originalUrl.includes('sslmode')) {
      const separator = originalUrl.includes('?') ? '&' : '?';
      secureUrl = `${originalUrl}${separator}sslaccept=strict`;
    }

    try {
      // 🚀 优先尝试安全连接
      if (secureUrl !== originalUrl) {
        console.log('🛡️  正在尝试开启安全传输模式 (SSL)...');
      }
      this.prismaInstance = new PrismaClient({ datasources: { db: { url: secureUrl } } });
      await this.prismaInstance.$connect();
      console.log('✅ MySQL 连接成功 (安全模式)');
    } catch (err: any) {
      if (secureUrl !== originalUrl) {
        console.warn('⚠️  安全连接失败，正在自动回退到原始连接模式...');
        try {
          // ↩️ 步骤 2：回退到原始连接
          if (this.prismaInstance) await this.prismaInstance.$disconnect();
          this.prismaInstance = new PrismaClient({ datasources: { db: { url: originalUrl } } });
          await this.prismaInstance.$connect();
          console.log('✅ MySQL 连接成功 (回退原始模式)');
        } catch (fallbackErr: any) {
          console.error('❌ MySQL 最终连接失败:', fallbackErr.message || fallbackErr);
          this.prismaInstance = null;
        }
      } else {
        console.error('❌ MySQL 连接失败:', err.message || err);
        this.prismaInstance = null;
      }
    }
  }

  public static getPrisma() {
    if (this.dbType !== 'mysql' || !this.prismaInstance) {
      throw new Error('当前非 MySQL 模式或 Prisma 未初始化');
    }
    return this.prismaInstance;
  }

  public static getType() {
    return this.dbType;
  }
}
