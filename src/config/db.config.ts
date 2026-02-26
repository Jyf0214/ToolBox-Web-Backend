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
    let url = process.env.DATABASE_URL || '';
    
    // 🛡️ 自动要求加密：如果用户提供的是不安全的 MySQL 连接，自动补全 SSL 参数
    if (url.startsWith('mysql://') && !url.includes('sslaccept') && !url.includes('sslmode')) {
      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}sslaccept=strict`;
      console.log('🛡️  检测到不安全的连接，已自动开启 MySQL 安全传输模式 (SSL)');
    }

    try {
      // 覆盖环境变量，确保 Prisma 使用加密后的 URL
      this.prismaInstance = new PrismaClient({
        datasources: {
          db: { url }
        }
      });
      await this.prismaInstance.$connect();
      console.log('✅ MySQL (Prisma 6.x) 连接成功');
    } catch (err: any) {
      console.error('❌ MySQL 连接失败:', err.message || err);
      this.prismaInstance = null;
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
