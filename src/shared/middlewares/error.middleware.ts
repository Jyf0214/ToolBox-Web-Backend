import { Request, Response, NextFunction } from 'express';

/**
 * 通用错误类型定义
 */
export class AppError extends Error {
  public readonly status: number;
  public readonly isOperational: boolean;

  constructor(message: string, status: number = 500, isOperational: boolean = true) {
    super(message);
    this.status = status;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 全局错误处理中间件
 */
export function errorHandler(err: Error | AppError, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof AppError) {
    res.status(err.status).json({
      success: false,
      message: err.message,
      status: err.status,
    });
    return;
  }

  // 未知错误
  console.error('未处理的错误:', err);
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? '服务器内部错误' : err.message,
    status: 500,
  });
}

/**
 * 404 错误处理
 */
export function notFoundHandler(req: Request, res: Response, next: NextFunction): void {
  res.status(404).json({
    success: false,
    message: `请求路径不存在：${req.originalUrl}`,
    status: 404,
  });
}
