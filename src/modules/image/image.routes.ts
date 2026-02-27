import os from 'os';
import { Router } from 'express';
import multer from 'multer';
import { imageController } from './image.controller';
import { verifyToken, isAdmin } from '../../shared/middlewares/auth.middleware';

const router = Router();
const upload = multer({ dest: os.tmpdir() });

// 接收前端处理好的多个 Blob/File
router.post('/batch-upload', upload.array('files'), (req, res) => imageController.batchUpload(req, res));
router.get('/download/:jobId', (req, res) => imageController.download(req, res));

// 管理员专用接口
router.get('/', verifyToken, isAdmin, (req, res, next) => imageController.getImages(req, res, next));
router.delete('/:id', verifyToken, isAdmin, (req, res, next) => imageController.deleteImage(req, res, next));

export default router;
