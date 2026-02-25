import { exec } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import util from 'util';

import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { PDFDocument } from 'pdf-lib';
import AdmZip from 'adm-zip';

import { generateDownloadToken } from '../../shared/middlewares/token.middleware';

const execAsync = util.promisify(exec);

interface ConvertJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  inputPath: string;
  outputPath?: string;
  outputFileName: string;
  token?: string;
  error?: string;
  createdAt: number;
  isZip: boolean;
  progress?: {
    total: number;
    current: number;
    message: string;
  };
  options?: {
    makeEven?: boolean;
  };
}

const convertJobs = new Map<string, ConvertJob>();

export class ConvertController {
  public docxToPdf(req: Request, res: Response, _next: NextFunction) {
    if (!req.file) {
      res.status(400).json({ success: false, message: '请上传文件' });
      return;
    }

    const jobId = uuidv4();
    const inputPath = req.file.path;
    const originalName = path.parse(req.file.originalname).name;
    const isZip = req.file.originalname.toLowerCase().endsWith('.zip');
    
    const makeEven = req.body.makeEven === 'true' || req.body.makeEven === true;

    const job: ConvertJob = {
      id: jobId,
      status: 'pending',
      inputPath,
      outputFileName: isZip ? `${originalName}_converted.zip` : `${originalName}.pdf`,
      createdAt: Date.now(),
      isZip,
      options: { makeEven }
    };

    convertJobs.set(jobId, job);

    this.processConversion(jobId, inputPath, isZip, makeEven)
      .catch((error) => {
        console.error(`[Job ${jobId}] Critical error:`, error);
        const failedJob = convertJobs.get(jobId);
        if (failedJob) {
          failedJob.status = 'failed';
          failedJob.error = error instanceof Error ? error.message : '未知错误';
          convertJobs.set(jobId, failedJob);
        }
      });

    res.status(202).json({
      success: true,
      message: '任务已提交',
      jobId,
    });
  }

  private async processConversion(jobId: string, inputPath: string, isZip: boolean, makeEven: boolean) {
    const job = convertJobs.get(jobId);
    if (!job) return;

    job.status = 'processing';
    const tempBaseDir = path.join(os.tmpdir(), `job_${jobId}`);
    fs.mkdirSync(tempBaseDir, { recursive: true });

    try {
      if (isZip) {
        await this.handleZipProcessing(job, inputPath, tempBaseDir, makeEven);
      } else {
        await this.handleSingleFileProcessing(job, inputPath, tempBaseDir, makeEven);
      }

      job.token = generateDownloadToken('anonymous');
      job.status = 'completed';
      convertJobs.set(jobId, job);
    } catch (error: any) {
      job.status = 'failed';
      job.error = error.message;
      convertJobs.set(jobId, job);
      throw error;
    } finally {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    }
  }

  private async handleSingleFileProcessing(job: ConvertJob, inputPath: string, outDir: string, makeEven: boolean) {
    job.progress = { total: 1, current: 0, message: '正在转换...' };
    const pdfPath = await this.convertDocxToPdf(inputPath, outDir, makeEven);
    job.outputPath = pdfPath;
    job.progress.current = 1;
  }

  private async handleZipProcessing(job: ConvertJob, inputPath: string, tempBaseDir: string, makeEven: boolean) {
    const unzipDir = path.join(tempBaseDir, 'unzip');
    const outputDir = path.join(tempBaseDir, 'output');
    fs.mkdirSync(unzipDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });

    const zip = new AdmZip(inputPath);
    zip.extractAllTo(unzipDir, true);

    const allFiles: string[] = [];
    const walk = (dir: string) => {
      fs.readdirSync(dir).forEach(file => {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
          walk(fullPath);
        } else if (file.toLowerCase().endsWith('.docx')) {
          allFiles.push(fullPath);
        }
      });
    };
    walk(unzipDir);

    job.progress = { total: allFiles.length, current: 0, message: `共 ${allFiles.length} 个文件` };
    convertJobs.set(job.id, job);

    const outZip = new AdmZip();

    // 单线程依次处理 (后续可轻松改为 Promise.all 实现多线程)
    for (const file of allFiles) {
      const relativePath = path.relative(unzipDir, file);
      const fileOutDir = path.join(outputDir, path.dirname(relativePath));
      
      job.progress.message = `正在处理: ${path.basename(file)}`;
      convertJobs.set(job.id, job);

      const pdfPath = await this.convertDocxToPdf(file, fileOutDir, makeEven);
      
      const zipPath = path.join(path.dirname(relativePath), path.basename(pdfPath));
      outZip.addLocalFile(pdfPath, path.dirname(relativePath));
      
      job.progress.current++;
      convertJobs.set(job.id, job);
    }

    const finalZipPath = path.join(tempBaseDir, job.outputFileName);
    outZip.writeZip(finalZipPath);
    job.outputPath = finalZipPath;
    
    // 清理中间目录
    fs.rmSync(unzipDir, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
  }

  private async convertDocxToPdf(docxPath: string, outDir: string, makeEven: boolean): Promise<string> {
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    
    const command = `libreoffice --headless --convert-to pdf --outdir "${outDir}" "${docxPath}"`;
    await execAsync(command);

    const originalName = path.parse(docxPath).name;
    const files = fs.readdirSync(outDir);
    // 这里的逻辑需要更精准，因为 outDir 下可能已有其他 PDF
    const expectedName = `${originalName}.pdf`;
    const pdfPath = path.join(outDir, expectedName);

    if (!fs.existsSync(pdfPath)) {
      throw new Error(`转换失败: ${path.basename(docxPath)}`);
    }

    if (makeEven) {
      const pdfBytes = fs.readFileSync(pdfPath);
      const pdfDoc = await PDFDocument.load(pdfBytes);
      if (pdfDoc.getPageCount() % 2 !== 0) {
        pdfDoc.addPage();
        fs.writeFileSync(pdfPath, Buffer.from(await pdfDoc.save()));
      }
    }

    return pdfPath;
  }

  public getStatus(req: Request, res: Response) {
    const jobId = req.params.jobId as string;
    const job = convertJobs.get(jobId);

    if (!job) {
      res.status(404).json({ success: false, message: '未找到任务' });
      return;
    }

    res.json({
      success: true,
      jobId: job.id,
      status: job.status,
      outputFileName: job.outputFileName,
      progress: job.progress,
      downloadToken: job.status === 'completed' ? job.token : undefined,
      downloadUrl: job.status === 'completed' ? `/api/convert/download/${jobId}?token=${job.token}` : undefined,
      error: job.error
    });
  }

  public downloadFile(req: Request, res: Response) {
    const jobId = req.params.jobId as string;
    const token = req.query.token as string;
    const job = convertJobs.get(jobId);

    if (!job || !job.outputPath || job.token !== token) {
      res.status(403).json({ success: false, message: '无效凭证' });
      return;
    }

    const encodedFileName = encodeURIComponent(job.outputFileName).replace(/['()]/g, escape).replace(/\*/g, '%2A');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(job.outputFileName)}"; filename*=UTF-8''${encodedFileName}`);
    res.setHeader('Content-Type', job.isZip ? 'application/zip' : 'application/pdf');

    res.sendFile(path.resolve(job.outputPath), (err) => {
      if (!err) {
        const jobDir = path.dirname(job.outputPath!);
        if (jobDir !== os.tmpdir()) {
          fs.rmSync(jobDir, { recursive: true, force: true });
        }
        convertJobs.delete(jobId);
      }
    });
  }
}

export const convertController = new ConvertController();
