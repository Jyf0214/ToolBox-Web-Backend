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
  /**
   * 处理直接上传转换 (DOCX 或 ZIP)
   */
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

  /**
   * 处理分块上传
   */
  public async uploadChunk(req: Request, res: Response) {
    const { uploadId, index, total, fileName, makeEven } = req.body;
    const chunk = req.file;

    if (!chunk) {
      res.status(400).json({ success: false, message: '无分块数据' });
      return;
    }

    const chunkDir = path.join(os.tmpdir(), `chunks_${uploadId}`);
    if (!fs.existsSync(chunkDir)) fs.mkdirSync(chunkDir, { recursive: true });

    // 存储分块
    const chunkPath = path.join(chunkDir, `${index}`);
    fs.renameSync(chunk.path, chunkPath);

    // 检查是否所有分块都已到达
    const chunks = fs.readdirSync(chunkDir);
    if (chunks.length === parseInt(total)) {
      // 开始合并
      const finalPath = path.join(os.tmpdir(), `upload_${uploadId}_${fileName}`);
      const writeStream = fs.createWriteStream(finalPath);
      
      const chunkCount = parseInt(total);
      for (let i = 0; i < chunkCount; i++) {
        const p = path.join(chunkDir, `${i}`);
        const buf = fs.readFileSync(p);
        writeStream.write(buf);
        fs.unlinkSync(p); // 删除已合并分块
      }
      writeStream.end();

      writeStream.on('finish', () => {
        fs.rmSync(chunkDir, { recursive: true, force: true });
        
        const isZip = fileName.toLowerCase().endsWith('.zip');
        const jobId = uploadId; 
        const originalName = path.parse(fileName).name;
        
        const job: ConvertJob = {
          id: jobId,
          status: 'pending',
          inputPath: finalPath,
          outputFileName: isZip ? `${originalName}_converted.zip` : `${originalName}.pdf`,
          createdAt: Date.now(),
          isZip,
          options: { makeEven: makeEven === 'true' }
        };

        convertJobs.set(jobId, job);
        this.processConversion(jobId, finalPath, isZip, job.options?.makeEven || false);
      });

      res.json({ success: true, message: '文件合并中', jobId: uploadId, merged: true });
      return;
    }

    res.json({ success: true, message: `分块 ${index} 接收成功`, merged: false });
  }

  private async processConversion(jobId: string, inputPath: string, isZip: boolean, makeEven: boolean) {
    const job = convertJobs.get(jobId);
    if (!job) return;

    job.status = 'processing';
    const tempBaseDir = path.join(os.tmpdir(), `job_${jobId}`);
    if (fs.existsSync(tempBaseDir)) fs.rmSync(tempBaseDir, { recursive: true, force: true });
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
      console.error(`[Job ${jobId}] Failed:`, error.message);
      job.status = 'failed';
      job.error = error.message;
      convertJobs.set(jobId, job);
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

    try {
      const zip = new AdmZip(inputPath);
      zip.extractAllTo(unzipDir, true);
    } catch (zipErr) {
      throw new Error('压缩包解析失败，请确保格式正确');
    }

    const allFiles: string[] = [];
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      fs.readdirSync(dir).forEach(file => {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
          walk(fullPath);
        } else if (file.toLowerCase().endsWith('.docx') && !file.startsWith('~$')) {
          allFiles.push(fullPath);
        }
      });
    };
    walk(unzipDir);

    if (allFiles.length === 0) throw new Error('未在压缩包中找到任何 .docx 文件');

    job.progress = { total: allFiles.length, current: 0, message: `准备处理 ${allFiles.length} 个文件` };
    convertJobs.set(job.id, job);

    const outZip = new AdmZip();

    for (const file of allFiles) {
      const relativePath = path.relative(unzipDir, file);
      const fileOutDir = path.join(outputDir, path.dirname(relativePath));
      
      job.progress.message = `转换: ${path.basename(file)}`;
      convertJobs.set(job.id, job);

      try {
        const pdfPath = await this.convertDocxToPdf(file, fileOutDir, makeEven);
        const zipEntryPath = path.join(path.dirname(relativePath));
        outZip.addLocalFile(pdfPath, zipEntryPath === '.' ? '' : zipEntryPath);
      } catch (err: any) {
        console.warn(`[ZIP Job ${job.id}] Skipping file ${file}:`, err.message);
      }
      
      job.progress.current++;
      convertJobs.set(job.id, job);
    }

    const finalZipPath = path.join(tempBaseDir, job.outputFileName);
    outZip.writeZip(finalZipPath);
    job.outputPath = finalZipPath;
  }

  private async convertDocxToPdf(docxPath: string, outDir: string, makeEven: boolean): Promise<string> {
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    
    const command = `libreoffice --headless --convert-to pdf --outdir "${outDir}" "${docxPath}"`;
    await execAsync(command);

    const originalName = path.parse(docxPath).name;
    const pdfPath = path.join(outDir, `${originalName}.pdf`);

    if (!fs.existsSync(pdfPath)) {
      const fallbackPdf = fs.readdirSync(outDir).find(f => f.endsWith('.pdf'));
      if (!fallbackPdf) throw new Error(`文件生成失败: ${path.basename(docxPath)}`);
      return path.join(outDir, fallbackPdf);
    }

    if (makeEven) {
      try {
        const pdfBytes = fs.readFileSync(pdfPath);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        if (pdfDoc.getPageCount() % 2 !== 0) {
          pdfDoc.addPage();
          fs.writeFileSync(pdfPath, Buffer.from(await pdfDoc.save()));
        }
      } catch (e) {
        console.warn('补全偶数页失败:', e);
      }
    }

    return pdfPath;
  }

  public getStatus(req: Request, res: Response) {
    const jobId = req.params.jobId as string;
    const job = convertJobs.get(jobId);
    if (!job) return res.status(404).json({ success: false, message: '未找到任务' });

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

    const rawName = job.outputFileName;
    const uriEncodedName = encodeURIComponent(rawName);
    const rfc6266Name = uriEncodedName
      .replace(/\(/g, '%28')
      .replace(/\)/g, '%29')
      .replace(/\!/g, '%21')
      .replace(/\'/g, '%27')
      .replace(/\*/g, '%2A');

    res.setHeader('Content-Disposition', `attachment; filename="${uriEncodedName}"; filename*=UTF-8''${rfc6266Name}`);
    res.setHeader('Content-Type', job.isZip ? 'application/zip' : 'application/pdf');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

    res.sendFile(path.resolve(job.outputPath), (err) => {
      if (!err) {
        const jobDir = path.dirname(job.outputPath!);
        if (jobDir.includes('job_')) fs.rmSync(jobDir, { recursive: true, force: true });
        convertJobs.delete(jobId);
      }
    });
  }
}

export const convertController = new ConvertController();
