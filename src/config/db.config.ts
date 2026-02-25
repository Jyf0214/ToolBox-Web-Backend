import mongoose from 'mongoose';
import prisma from './mysql.config';
import dotenv from 'dotenv';

dotenv.config();

/**
 * 自动检测并连接数据库
 * 支持 MySQL (prisma) 和 MongoDB (mongoose)
 */
export const connectDatabase = async () => {
  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error('❌ 错误: 未设置 DATABASE_URL 环境变量');
    process.exit(1);
  }

  try {
    if (url.startsWith('mongodb://') || url.startsWith('mongodb+srv://')) {
      await mongoose.connect(url);
      console.log('✅ MongoDB 连接成功 (Mongoose)');
      return { type: 'mongodb', instance: mongoose };
    } 
    
    if (url.startsWith('mysql://') || url.startsWith('postgresql://')) {
      // Prisma 支持多种 SQL，这里重点适配 MySQL
      await prisma.$connect();
      console.log('✅ MySQL/SQL 连接成功 (Prisma)');
      return { type: 'mysql', instance: prisma };
    }

    throw new Error('未知的数据库类型，请检查 DATABASE_URL');
  } catch (error) {
    console.error('❌ 数据库连接失败:', error);
    process.exit(1);
  }
};
