import express, { Application } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { errorHandler, notFoundHandler } from './shared/middlewares/error.middleware';
import { rateLimit } from './shared/middlewares/validation.middleware';
import userRoutes from './modules/user/user.routes';
import convertRoutes from './modules/convert/convert.routes';

dotenv.config();

/**
 * Express 应用实例
 */
const app: Application = express();

// 信任代理 (生产环境需配置)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// 基础中间件
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 全局限流
app.use(rateLimit(100, 60000));

// 模块路由
app.use('/api/users', userRoutes);
app.use('/api/convert', convertRoutes);

// 健康检查接口
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Backend is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// 404 处理
app.use(notFoundHandler);

// 全局错误处理
app.use(errorHandler);

export default app;
