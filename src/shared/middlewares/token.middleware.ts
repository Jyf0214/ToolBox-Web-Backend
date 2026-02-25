import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

interface TokenData {
  userId: string;
  expiresAt: number;
  downloadCount: number;
}

/**
 * Token 生成记录 (内存存储，生产环境应使用 Redis)
 */
const activeTokens = new Map<string, TokenData>();

/**
 * Token 有效期 (延长至 15 分钟)
 */
const TOKEN_EXPIRY = 15 * 60 * 1000;

/**
 * 最大下载次数 (设为 100，相当于有效期内不限次)
 */
const MAX_DOWNLOAD_COUNT = 100;

/**
 * 生成下载 Token
 * @param userId 用户 ID
 * @returns Token 字符串
 */
export function generateDownloadToken(userId: string = 'anonymous'): string {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + TOKEN_EXPIRY;
  activeTokens.set(token, {
    userId,
    expiresAt,
    downloadCount: 0,
  });

  // 清理过期 token 的定时器
  setTimeout(() => {
    activeTokens.delete(token);
  }, TOKEN_EXPIRY);

  return token;
}

/**
 * 扩展 Request 接口
 */
interface AuthenticatedRequest extends Request {
  tokenData?: TokenData;
}

/**
 * 验证下载 Token 的中间件
 */
export function verifyDownloadToken(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const token = (req.query.token as string) || (req.headers['x-download-token'] as string);

  if (!token) {
    res.status(401).json({ success: false, message: '缺少下载凭证 (token)' });
    return;
  }

  const tokenData = activeTokens.get(token);
  if (!tokenData) {
    res.status(403).json({ success: false, message: '无效的下载凭证' });
    return;
  }

  if (Date.now() > tokenData.expiresAt) {
    activeTokens.delete(token);
    res.status(403).json({ success: false, message: '下载凭证已过期' });
    return;
  }

  if (tokenData.downloadCount >= MAX_DOWNLOAD_COUNT) {
    activeTokens.delete(token);
    res.status(403).json({ success: false, message: '下载次数已达上限' });
    return;
  }

  // 增加下载次数
  tokenData.downloadCount += 1;
  activeTokens.set(token, tokenData);

  // 将 token 信息附加到请求对象
  req.tokenData = tokenData;
  next();
}

/**
 * 验证 Token 并包装下载响应
 */
export function verifyAndDownload(req: Request, res: Response, filePath: string, fileName: string): void {
  const token = req.query.token as string;

  if (!token) {
    res.status(401).json({ success: false, message: '缺少下载凭证' });
    return;
  }

  const tokenData = activeTokens.get(token);
  if (!tokenData) {
    res.status(403).json({ success: false, message: '无效的下载凭证' });
    return;
  }

  if (Date.now() > tokenData.expiresAt) {
    activeTokens.delete(token);
    res.status(403).json({ success: false, message: '下载凭证已过期' });
    return;
  }

  if (tokenData.downloadCount >= MAX_DOWNLOAD_COUNT) {
    activeTokens.delete(token);
    res.status(403).json({ success: false, message: '下载次数已达上限' });
    return;
  }

  tokenData.downloadCount += 1;
  activeTokens.set(token, tokenData);

  res.download(filePath, fileName, (_err) => {
    // 清理逻辑
  });
}

/**
 * 清理所有过期 token
 */
export function cleanupExpiredTokens(): void {
  const now = Date.now();
  for (const [token, data] of activeTokens.entries()) {
    if (now > data.expiresAt) {
      activeTokens.delete(token);
    }
  }
}
