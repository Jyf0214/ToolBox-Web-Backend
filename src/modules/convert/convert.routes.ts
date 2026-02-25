import os from 'os';

import { Router } from 'express';
import multer from 'multer';

import { convertController } from './convert.controller';

const router = Router();
const upload = multer({
  dest: os.tmpdir(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB 限制
  },
});

// 提交转换任务
router.post('/docx-to-pdf', upload.single('file'), (req, res, next) => convertController.docxToPdf(req, res, next));

// 查询转换状态
router.get('/status/:jobId', (req, res) => convertController.getStatus(req, res));

// 下载转换后的文件 (需要 token)
router.get('/download/:jobId', (req, res) => convertController.downloadFile(req, res));

export default router;
