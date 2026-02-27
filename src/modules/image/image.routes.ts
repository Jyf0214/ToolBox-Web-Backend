import os from 'os';
import { Router } from 'express';
import multer from 'multer';
import { imageController } from './image.controller';
import { verifyToken, isAdmin } from '../../shared/middlewares/auth.middleware';

import { audit } from '../../shared/middlewares/audit.middleware';

const router = Router();
const upload = multer({ dest: os.tmpdir() });

// 可选鉴权以支持用量统计
const optionalAuth = (req: any, res: any, next: any) => {
  if (req.headers.authorization) return verifyToken(req, res, next);
  next();
};

// 接收前端处理好的多个 Blob/File (增加审计)
router.post('/batch-upload', upload.array('files'), optionalAuth, audit('IMAGE_BATCH_CROP', 'IMAGE'), (req, res) => imageController.batchUpload(req, res));
router.get('/download/:jobId', (req, res) => imageController.download(req, res));

// 管理员专用接口
router.get('/', verifyToken, isAdmin, (req, res, next) => imageController.getImages(req, res, next));
router.delete('/:id', verifyToken, isAdmin, (req, res, next) => imageController.deleteImage(req, res, next));

export default router;
