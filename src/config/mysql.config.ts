import { PrismaClient } from '@prisma/client';

/**
 * Prisma Client 实例 (用于 MySQL)
 */
const prisma = new PrismaClient();

export const connectMySQL = async () => {
  try {
    await prisma.$connect();
    console.log('✅ MySQL 连接成功');
  } catch (error) {
    console.error('❌ MySQL 连接失败:', error);
    process.exit(1);
  }
};

export default prisma;
