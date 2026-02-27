import { exec } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import util from 'util';

import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { PDFDocument } from 'pdf-lib';
import AdmZip from 'adm-zip';
import pLimit from 'p-limit';

import { generateDownloadToken } from '../../shared/middlewares/token.middleware';

const execAsync = util.promisify(exec);
const CONCURRENCY_LIMIT = 10;

interface ConvertJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  inputPath: string;
  outputPath?: string;
  outputFileName: string;
  outputSize?: number; // 产物真实大小
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

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of convertJobs.entries()) {
    if (now - job.createdAt > 30 * 60 * 1000) {
      if (job.outputPath && fs.existsSync(job.outputPath)) {
        const jobDir = path.dirname(job.outputPath);
        if (jobDir.includes('job_')) fs.rmSync(jobDir, { recursive: true, force: true });
      }
      convertJobs.delete(id);
    }
  }
}, 10 * 60 * 1000);

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
    this.processConversion(jobId, inputPath, isZip, makeEven);
    res.status(202).json({ success: true, message: '任务已提交', jobId });
  }

  public async uploadChunk(req: Request, res: Response) {
    const { uploadId, index, total, fileName, makeEven } = req.body;
    const chunk = req.file;
    if (!chunk) return res.status(400).json({ success: false, message: '无分块数据' });

    const chunkDir = path.join(os.tmpdir(), `chunks_${uploadId}`);
    if (!fs.existsSync(chunkDir)) fs.mkdirSync(chunkDir, { recursive: true });

    const chunkPath = path.join(chunkDir, `${index}`);
    fs.renameSync(chunk.path, chunkPath);

    const chunks = fs.readdirSync(chunkDir);
    if (chunks.length === parseInt(total)) {
      const finalPath = path.join(os.tmpdir(), `upload_${uploadId}_${fileName}`);
      const writeStream = fs.createWriteStream(finalPath);
      
      const chunkCount = parseInt(total);
      for (let i = 0; i < chunkCount; i++) {
        const p = path.join(chunkDir, `${i}`);
        if (fs.existsSync(p)) {
          writeStream.write(fs.readFileSync(p));
          fs.unlinkSync(p);
        }
      }
      writeStream.end();

      writeStream.on('finish', () => {
        fs.rmSync(chunkDir, { recursive: true, force: true });
        const isZip = fileName.toLowerCase().endsWith('.zip');
        const job: ConvertJob = {
          id: uploadId,
          status: 'pending',
          inputPath: finalPath,
          outputFileName: isZip ? `${path.parse(fileName).name}_converted.zip` : `${path.parse(fileName).name}.pdf`,
          createdAt: Date.now(),
          isZip,
          options: { makeEven: makeEven === 'true' }
        };
        convertJobs.set(uploadId, job);
        this.processConversion(uploadId, finalPath, isZip, job.options?.makeEven || false);
      });
      return res.json({ success: true, jobId: uploadId, merged: true });
    }
    res.json({ success: true, merged: false });
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
      
      // 计算真实大小
      if (job.outputPath && fs.existsSync(job.outputPath)) {
        job.outputSize = fs.statSync(job.outputPath).size;
      }

      job.token = generateDownloadToken('anonymous');
      job.status = 'completed';
    } catch (error: any) {
      job.status = 'failed';
      job.error = error.message;
    } finally {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      convertJobs.set(jobId, job);
    }
  }

  private async handleSingleFileProcessing(job: ConvertJob, inputPath: string, outDir: string, makeEven: boolean) {
    job.progress = { total: 1, current: 0, message: '正在转换...' };
    job.outputPath = await this.convertWithRetry(inputPath, outDir, makeEven);
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
    } catch { throw new Error('压缩包解析失败'); }

    const convertFiles: string[] = []; // 需要转换的 docx
    const keepFiles: { fullPath: string; relativePath: string }[] = []; // 需要保留的 pdf

    const walk = (dir: string) => {
      fs.readdirSync(dir).forEach(file => {
        const fullPath = path.join(dir, file);
        const relativePath = path.relative(unzipDir, fullPath);
        if (fs.statSync(fullPath).isDirectory()) walk(fullPath);
        else if (file.toLowerCase().endsWith('.docx') && !file.startsWith('~$')) convertFiles.push(fullPath);
        else if (file.toLowerCase().endsWith('.pdf')) keepFiles.push({ fullPath, relativePath });
      });
    };
    walk(unzipDir);

    if (convertFiles.length === 0 && keepFiles.length === 0) throw new Error('压缩包内无可处理的文件');

    job.progress = { total: convertFiles.length, current: 0, message: '开始并行处理...' };
    const limit = pLimit(CONCURRENCY_LIMIT);
    const convertedResults: { relativePath: string; pdfPath: string }[] = [];

    const tasks = convertFiles.map((file) => limit(async () => {
      const relativePath = path.relative(unzipDir, file);
      const fileOutDir = path.join(outputDir, path.dirname(relativePath));
      const pdfPath = await this.convertWithRetry(file, fileOutDir, makeEven);
      convertedResults.push({ relativePath, pdfPath });
      job.progress!.current++;
      job.progress!.message = `正在转换: ${path.basename(file)} (${job.progress!.current}/${job.progress!.total})`;
      convertJobs.set(job.id, job);
    }));

    await Promise.all(tasks);

    const outZip = new AdmZip();
    // 1. 添加转换后的 PDF
    for (const res of convertedResults) {
      const zipEntryPath = path.dirname(res.relativePath);
      outZip.addLocalFile(res.pdfPath, zipEntryPath === '.' ? '' : zipEntryPath);
    }
    // 2. 添加保留的原有 PDF (维持目录结构)
    for (const keep of keepFiles) {
      const zipEntryPath = path.dirname(keep.relativePath);
      outZip.addLocalFile(keep.fullPath, zipEntryPath === '.' ? '' : zipEntryPath);
    }

    const finalZipPath = path.join(tempBaseDir, job.outputFileName);
    outZip.writeZip(finalZipPath);
    job.outputPath = finalZipPath;
  }

  private async convertWithRetry(docxPath: string, outDir: string, makeEven: boolean, retries = 2): Promise<string> {
    let lastError;
    for (let i = 0; i <= retries; i++) {
      try {
        return await this.convertDocxToPdf(docxPath, outDir, makeEven);
      } catch (e: any) {
        lastError = e;
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    throw lastError;
  }

  private async convertDocxToPdf(docxPath: string, outDir: string, makeEven: boolean): Promise<string> {
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const profileId = uuidv4();
    const userProfileDir = path.join(os.tmpdir(), `libre_profile_${profileId}`);
    const command = `libreoffice -env:UserInstallation=file://${userProfileDir} --headless --convert-to pdf --outdir "${outDir}" "${docxPath}"`;
    
    try {
      await execAsync(command);
      const originalName = path.parse(docxPath).name;
      const pdfPath = path.join(outDir, `${originalName}.pdf`);
      
      if (!fs.existsSync(pdfPath)) {
        const files = fs.readdirSync(outDir);
        const fallback = files.find(f => f.toLowerCase().endsWith('.pdf'));
        if (!fallback) throw new Error('PDF 生成失败');
        return path.join(outDir, fallback);
      }

      if (makeEven) {
        try {
          const pdfBytes = fs.readFileSync(pdfPath);
          const pdfDoc = await PDFDocument.load(pdfBytes);
          const pageCount = pdfDoc.getPageCount();
          
          if (pageCount % 2 !== 0) {
            console.log(`[PDF] Adding blank page to ${originalName}.pdf (Current: ${pageCount})`);
            pdfDoc.addPage();
            const modifiedPdfBytes = await pdfDoc.save();
            fs.writeFileSync(pdfPath, Buffer.from(modifiedPdfBytes));
          }
        } catch (err: any) {
          console.error(`[MakeEven Error] Failed to process ${pdfPath}:`, err.message);
        }
      }
      return pdfPath;
    } finally {
      if (fs.existsSync(userProfileDir)) fs.rmSync(userProfileDir, { recursive: true, force: true });
    }
  }

  public getStatus(req: Request, res: Response) {
    const jobId = req.params.jobId as string;
    const job = convertJobs.get(jobId);
    if (!job) return res.status(404).json({ success: false, message: '任务不存在' });
    res.json({
      success: true,
      jobId: job.id,
      status: job.status,
      outputFileName: job.outputFileName,
      outputSize: job.outputSize, // 包含物理大小
      progress: job.progress,
      downloadToken: job.status === 'completed' ? job.token : undefined,
      error: job.error
    });
  }

  public downloadFile(req: Request, res: Response) {
    const jobId = req.params.jobId as string;
    const token = req.query.token as string;
    const job = convertJobs.get(jobId);

    if (!job || job.status !== 'completed' || !job.token || job.token !== token || !job.outputPath) {
      res.status(403).json({ success: false, message: '无效凭证' });
      return;
    }

    const uriEncodedName = encodeURIComponent(job.outputFileName);
    const rfc6266Name = uriEncodedName.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\!/g, '%21').replace(/\'/g, '%27').replace(/\*/g, '%2A');

    res.setHeader('Content-Disposition', `attachment; filename="${uriEncodedName}"; filename*=UTF-8''${rfc6266Name}`);
    res.setHeader('Content-Type', job.isZip ? 'application/zip' : 'application/pdf');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.sendFile(path.resolve(job.outputPath));
  }
}

export const convertController = new ConvertController();
