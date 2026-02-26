import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import os from 'os';
import AdmZip from 'adm-zip';
import { generateDownloadToken } from '../../shared/middlewares/token.middleware';

interface ImageJob {
  id: string;
  status: 'processing' | 'completed' | 'failed';
  outputPath?: string;
  token?: string;
  createdAt: number;
}

export class ImageController {
  private static jobs = new Map<string, ImageJob>();

  /**
   * 接收已裁剪的批量文件并打包
   */
  public async batchUpload(req: Request, res: Response) {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, message: '未接收到处理后的文件' });
    }

    const jobId = uuidv4();
    const tempDir = path.join(os.tmpdir(), `img_job_${jobId}`);
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      const zip = new AdmZip();
      files.forEach(file => {
        // file.originalname 包含了用户原始文件名
        zip.addLocalFile(file.path, '', `cropped_${file.originalname}`);
      });

      const zipPath = path.join(tempDir, 'processed_images.zip');
      zip.writeZip(zipPath);

      const token = generateDownloadToken('anonymous');
      ImageController.jobs.set(jobId, {
        id: jobId,
        status: 'completed',
        outputPath: zipPath,
        token,
        createdAt: Date.now()
      });

      res.json({ success: true, jobId, token });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    } finally {
      // 清理临时单个上传文件
      files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
    }
  }

  public download(req: Request, res: Response) {
    const jobId = req.params.jobId as string;
    const token = req.query.token as string;
    const job = ImageController.jobs.get(jobId);

    if (!job || job.token !== token || !job.outputPath) {
      return res.status(403).json({ success: false, message: '无效凭证' });
    }

    res.download(job.outputPath, 'cropped_images.zip', () => {
      fs.rmSync(path.dirname(job.outputPath!), { recursive: true, force: true });
      ImageController.jobs.delete(jobId);
    });
  }
}

export const imageController = new ImageController();
