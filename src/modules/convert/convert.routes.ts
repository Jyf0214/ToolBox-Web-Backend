import { Router } from 'express';
import multer from 'multer';
import os from 'os';
import { convertController } from './convert.controller';

const router = Router();
const upload = multer({ dest: os.tmpdir() });

// 定义转换路由
router.post('/docx-to-pdf', upload.single('file'), convertController.docxToPdf);

export default router;
