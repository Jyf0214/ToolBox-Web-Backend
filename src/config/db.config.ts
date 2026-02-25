import mongoose from 'mongoose';
import prisma from './mysql.config';
import dotenv from 'dotenv';

dotenv.config();

export interface DatabaseConnection {
  type: 'mongodb' | 'mysql' | 'none';
  instance?: typeof mongoose | typeof prisma;
}

/**
 * 自动检测并连接数据库
 * 支持 MySQL (prisma) 和 MongoDB (mongoose)
 * 数据库连接为可选，未配置时不影响服务启动
 */
export const connectDatabase = async (): Promise<DatabaseConnection> => {
  const url = process.env.DATABASE_URL;

  // 未配置数据库 URL 时返回无数据库模式
  if (!url || url === '' || url.startsWith('your_')) {
    console.warn('⚠️  未配置数据库连接，将以无数据库模式运行');
    return { type: 'none' };
  }

  try {
    if (url.startsWith('mongodb://') || url.startsWith('mongodb+srv://')) {
      await mongoose.connect(url);
      console.log('✅ MongoDB 连接成功 (Mongoose)');
      return { type: 'mongodb', instance: mongoose };
    }

    if (url.startsWith('mysql://') || url.startsWith('postgresql://')) {
      await prisma.$connect();
      console.log('✅ MySQL/SQL 连接成功 (Prisma)');
      return { type: 'mysql', instance: prisma };
    }

    throw new Error('未知的数据库类型，请检查 DATABASE_URL');
  } catch (error) {
    console.error('❌ 数据库连接失败:', error);
    // 数据库连接失败不退出服务，允许无数据库模式运行
    return { type: 'none' };
  }
};
