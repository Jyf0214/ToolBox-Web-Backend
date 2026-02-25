import cors from 'cors';
import { config } from 'dotenv';
import type { Application } from 'express';
import express, { json, urlencoded } from 'express';

import convertRoutes from './modules/convert/convert.routes';
import userRoutes from './modules/user/user.routes';
import { errorHandler, notFoundHandler } from './shared/middlewares/error.middleware';
import { rateLimit } from './shared/middlewares/validation.middleware';

config();

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
  origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*',
  credentials: true,
}));
app.use(json({ limit: '10mb' }));
app.use(urlencoded({ extended: true, limit: '10mb' }));

// 全局限流
app.use(rateLimit(100, 60000));

// 模块路由
app.use('/api/users', userRoutes);
app.use('/api/convert', convertRoutes);

// 后端首页欢迎信息
app.get('/', (req, res) => {
  res.json({
    name: 'ToolBox-Web Backend',
    version: '1.0.0',
    description: '一个极简、高效、模块化的在线工具箱后端 API',
    status: 'Running',
    author: 'Jyf0214',
    links: {
      github: 'https://github.com/Jyf0214/ToolBox-Web',
      health: '/health'
    }
  });
});

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
