import mongoose from 'mongoose';
import { PrismaClient } from '@prisma/client';

/**
 * 数据库适配器配置 (Prisma 7 适配版)
 */
export class DatabaseManager {
  private static prismaInstance: PrismaClient | null = null;
  private static dbType: 'mongodb' | 'mysql' | 'none' = 'none';

  /**
   * 初始化数据库连接
   */
  public static async connect() {
    const url = process.env.DATABASE_URL;

    if (!url) {
      console.log('⚠️  未检测到 DATABASE_URL，将运行在无数据库模式');
      return;
    }

    if (url.startsWith('mongodb')) {
      await this.connectMongoDB(url);
      this.dbType = 'mongodb';
    } else if (url.startsWith('mysql')) {
      await this.connectMySQL();
      this.dbType = 'mysql';
    } else {
      console.error('❌ 不支持的数据库协议类型:', url.split(':')[0]);
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
    const url = process.env.DATABASE_URL;
    try {
      // Prisma 7 强制要求在构造函数中提供配置 (如果 schema 中没写 url)
      this.prismaInstance = new PrismaClient({
        // @ts-ignore - 兼容某些版本下 Prisma 对 datasourceUrl 的类型推断问题
        datasourceUrl: url
      });
      await this.prismaInstance.$connect();
      console.log('✅ MySQL (Prisma 7) 连接成功');
    } catch (err) {
      console.error('❌ MySQL 连接失败:', err);
    }
  }

  public static getPrisma() {
    if (this.dbType !== 'mysql') throw new Error('当前非 MySQL 模式，无法获取 Prisma');
    return this.prismaInstance!;
  }

  public static getType() {
    return this.dbType;
  }
}
