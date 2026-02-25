import { Router } from 'express';
import multer from 'multer';
import os from 'os';
import { convertController } from './convert.controller';

const router = Router();
const upload = multer({
  dest: os.tmpdir(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB 限制
  },
});

// 提交转换任务
router.post('/docx-to-pdf', upload.single('file'), convertController.docxToPdf);

// 查询转换状态
router.get('/status/:jobId', convertController.getStatus);

// 下载转换后的文件 (需要 token)
router.get('/download/:jobId', convertController.downloadFile);

export default router;
