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

// 适当降低并发以换取极端稳定性，防止 OOM
const CONCURRENCY_LIMIT = 3;

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

// 全局定时清理：每 10 分钟清理一次，删除超过 30 分钟的任务和文件
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of convertJobs.entries()) {
    if (now - job.createdAt > 30 * 60 * 1000) {
      if (job.outputPath && fs.existsSync(job.outputPath)) {
        const jobDir = path.dirname(job.outputPath);
        if (jobDir.includes('job_')) fs.rmSync(jobDir, { recursive: true, force: true });
      }
      convertJobs.delete(id);
      console.log(`[Cleanup] Deleted expired job: ${id}`);
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
      job.token = generateDownloadToken('anonymous');
      job.status = 'completed';
    } catch (error: any) {
      console.error(`[Job ${jobId}] Failed:`, error.message);
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

    const allFiles: string[] = [];
    const walk = (dir: string) => {
      fs.readdirSync(dir).forEach(file => {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) walk(fullPath);
        else if (file.toLowerCase().endsWith('.docx') && !file.startsWith('~$')) allFiles.push(fullPath);
      });
    };
    walk(unzipDir);

    if (allFiles.length === 0) throw new Error('未找到 DOCX 文件');

    job.progress = { total: allFiles.length, current: 0, message: '开始并行转换...' };
    const limit = pLimit(CONCURRENCY_LIMIT);
    const results: { relativePath: string; pdfPath: string }[] = [];

    const tasks = allFiles.map((file) => limit(async () => {
      const relativePath = path.relative(unzipDir, file);
      const fileOutDir = path.join(outputDir, path.dirname(relativePath));
      const pdfPath = await this.convertWithRetry(file, fileOutDir, makeEven);
      results.push({ relativePath, pdfPath });
      job.progress!.current++;
      job.progress!.message = `正在处理: ${path.basename(file)} (${job.progress!.current}/${job.progress!.total})`;
      convertJobs.set(job.id, job);
    }));

    await Promise.all(tasks);

    // 关键校验：35 变 3 的终结者
    if (results.length !== allFiles.length) {
      throw new Error(`转换完整性校验失败: 预期 ${allFiles.length} 个，实际完成 ${results.length} 个`);
    }

    const outZip = new AdmZip();
    for (const res of results) {
      const zipEntryPath = path.dirname(res.relativePath);
      outZip.addLocalFile(res.pdfPath, zipEntryPath === '.' ? '' : zipEntryPath);
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
        console.warn(`[Retry] ${path.basename(docxPath)} attempt ${i+1} failed: ${e.message}`);
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
        if (!fallback) throw new Error('PDF 未生成');
        return path.join(outDir, fallback);
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
    } finally {
      if (fs.existsSync(userProfileDir)) fs.rmSync(userProfileDir, { recursive: true, force: true });
    }
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
      error: job.error
    });
  }

  public downloadFile(req: Request, res: Response) {
    const { jobId } = req.params;
    const { token } = req.query;
    const job = convertJobs.get(jobId);

    console.log(`[Download Attempt] Job: ${jobId}, Token: ${token}`);

    if (!job) {
      console.error(`[Download Failed] Task ${jobId} not found in memory`);
      res.status(404).json({ success: false, message: '未找到转换任务' });
      return;
    }

    if (job.status !== 'completed' || !job.token || job.token !== token || !job.outputPath) {
      console.error(`[Download Failed] Invalid creds or status for ${jobId}`);
      res.status(403).json({ success: false, message: '无效凭证或文件未就绪' });
      return;
    }

    const uriEncodedName = encodeURIComponent(job.outputFileName);
    const rfc6266Name = uriEncodedName.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\!/g, '%21').replace(/\'/g, '%27').replace(/\*/g, '%2A');

    res.setHeader('Content-Disposition', `attachment; filename="${uriEncodedName}"; filename*=UTF-8''${rfc6266Name}`);
    res.setHeader('Content-Type', job.isZip ? 'application/zip' : 'application/pdf');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

    // 修复点：不再立即删除！交给定时器清理
    res.sendFile(path.resolve(job.outputPath));
  }
}

export const convertController = new ConvertController();
