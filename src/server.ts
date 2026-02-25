import app from './app';
import { connectDatabase } from './config/db.config';

// 默认使用 7860 端口
const PORT = process.env.PORT || 7860;

/**
 * 启动服务
 */
const startServer = async () => {
  try {
    // 自动识别并连接数据库
    await connectDatabase();

    app.listen(PORT, () => {
      console.log(`🚀 Server is running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('启动服务失败:', error);
    process.exit(1);
  }
};

startServer();
