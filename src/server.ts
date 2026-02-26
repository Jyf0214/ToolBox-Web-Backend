import app from './app';
import { DatabaseManager } from './config/db.config';

// 默认使用 7860 端口
const PORT = process.env.PORT ?? 7860;

/**
 * 启动服务
 */
const startServer = async () => {
  try {
    // 初始化数据库
    await DatabaseManager.connect();

    const server = app.listen(PORT, () => {
      console.log(`🚀 服务器已启动：http://localhost:${PORT}`);
      console.log(`📝 健康检查：http://localhost:${PORT}/health`);
    });

    // 优雅关闭
    const gracefulShutdown = (signal: string) => {
      console.log(`\n⚠️  收到 ${signal} 信号，正在关闭服务...`);
      server.close(() => {
        console.log('✅ 服务器已关闭');
        process.exit(0);
      });

      // 10 秒后强制退出
      setTimeout(() => {
        console.error('❌ 未能优雅关闭，强制退出');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error) {
    console.error('❌ 启动服务失败:', error);
    process.exit(1);
  }
};

startServer();
