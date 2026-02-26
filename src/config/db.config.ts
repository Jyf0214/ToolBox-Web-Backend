import { exec } from 'child_process';
import util from 'util';
import mongoose from 'mongoose';
import { PrismaClient } from '@prisma/client';

const execAsync = util.promisify(exec);

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
    
    if (originalUrl.startsWith('mysql://') && !originalUrl.includes('sslaccept') && !originalUrl.includes('sslmode')) {
      const separator = originalUrl.includes('?') ? '&' : '?';
      secureUrl = `${originalUrl}${separator}sslaccept=strict`;
    }

    const tryConnectAndSync = async (targetUrl: string, modeName: string) => {
      this.prismaInstance = new PrismaClient({ datasources: { db: { url: targetUrl } } });
      await this.prismaInstance.$connect();
      console.log(`✅ MySQL 连接成功 (${modeName})`);
      
      // 🚀 核心增加：自动处理数据库结构同步 (db push)
      console.log('🔄 正在同步数据库结构...');
      try {
        // 关键安全修复：1. 显式指定 schema 路径；2. 隐藏环境变量打印，防止泄露密码
        await execAsync(`npx prisma db push --accept-data-loss --schema ./prisma/schema.prisma`, {
          env: { ...process.env, DATABASE_URL: targetUrl }
        });
        console.log('✨ 数据库结构同步成功');
      } catch (pushErr: any) {
        // 关键安全修复：不打印 pushErr.message，因为它可能包含连接字符串
        console.warn('⚠️  数据库结构同步未完全完成 (可能原因: 缺少 schema 文件、数据库权限不足或网络抖动)');
        console.log('ℹ️  提示：您可以检查 Docker 镜像中是否包含 ./prisma/schema.prisma 文件');
      }
    };

    try {
      if (secureUrl !== originalUrl) console.log('🛡️  正在尝试开启安全传输模式 (SSL)...');
      await tryConnectAndSync(secureUrl, '安全模式');
    } catch (err: any) {
      if (secureUrl !== originalUrl) {
        console.warn('⚠️  安全连接失败，正在自动回退到原始连接模式...');
        try {
          if (this.prismaInstance) await this.prismaInstance.$disconnect();
          await tryConnectAndSync(originalUrl, '回退原始模式');
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
