import os from 'os';
import { Router } from 'express';
import multer from 'multer';
import { convertController } from './convert.controller';
import { markdownController } from './markdown.controller';
import { audit } from '../../shared/middlewares/audit.middleware';
import { verifyToken } from '../../shared/middlewares/auth.middleware';

const router = Router();
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// 可选鉴权：如果带了 Token 则记录用户 UID
const optionalAuth = (req: any, res: any, next: any) => {
  if (req.headers.authorization) {
    return verifyToken(req, res, next);
  }
  next();
};

// DOCX 转换路由 (增加审计)
router.post('/docx-to-pdf', upload.single('file'), optionalAuth, audit('CONVERT_DOCX', 'CONVERT'), (req, res, next) => convertController.docxToPdf(req, res, next));
router.post('/upload-chunk', upload.single('file'), (req, res) => convertController.uploadChunk(req, res));
router.get('/status/:jobId', (req, res) => convertController.getStatus(req, res));
router.get('/download/:jobId', (req, res) => convertController.downloadFile(req, res));

// Markdown 转换路由
router.post('/md-to-pdf', optionalAuth, audit('CONVERT_MD', 'CONVERT'), (req, res) => markdownController.convert(req, res));
router.get('/md/status/:jobId', (req, res) => markdownController.getStatus(req, res));
router.get('/md/download/:jobId', (req, res) => markdownController.download(req, res));

export default router;
