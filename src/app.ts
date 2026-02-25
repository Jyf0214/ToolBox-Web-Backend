import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import userRoutes from './modules/user/user.routes';

dotenv.config();

/**
 * Express 应用实例
 */
const app: Application = express();

// 基础中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 模块路由
app.use('/api/users', userRoutes);

// 健康检查接口
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'OK', message: 'Backend is running' });
});

/**
 * 全局错误处理中间件
 */
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  const status = err.status || 500;
  const message = err.message || '服务器内部错误';
  res.status(status).json({
    success: false,
    status,
    message
  });
});

export default app;
