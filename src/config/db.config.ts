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
    try {
      this.prismaInstance = new PrismaClient();
      await this.prismaInstance.$connect();
      console.log('✅ MySQL (Prisma 6.x) 连接成功');
    } catch (err: any) {
      console.error('❌ MySQL 连接失败:', err.message || err);
      
      // 针对 TiDB Cloud / AWS RDS 等强制 SSL 的数据库提供建议
      if (err.message?.includes('insecure transport') || err.message?.includes('SSL')) {
        console.warn('💡 提示: 您的数据库强制要求安全连接。请尝试在 DATABASE_URL 末尾添加 ?sslaccept=strict 或 ?sslmode=no-verify');
      }
      
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
