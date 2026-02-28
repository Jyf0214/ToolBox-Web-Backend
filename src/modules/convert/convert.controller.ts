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
  outputSize?: number;
  token?: string;
  error?: string;
  createdAt: number;
  isZip: boolean;
  progress?: { total: number; current: number; message: string; };
  options?: { makeEven?: boolean; splitOddEven?: boolean; };
}

const convertJobs = new Map<string, ConvertJob>();

export class ConvertController {
  public docxToPdf(req: Request, res: Response, _next: NextFunction) {
    if (!req.file) return res.status(400).json({ success: false, message: '请上传文件' });

    const jobId = uuidv4();
    const originalName = path.parse(req.file.originalname).name;
    const isZip = req.file.originalname.toLowerCase().endsWith('.zip');
    const makeEven = req.body.makeEven === 'true' || req.body.makeEven === true;
    const splitOddEven = req.body.splitOddEven === 'true' || req.body.splitOddEven === true;

    const job: ConvertJob = {
      id: jobId,
      status: 'pending',
      inputPath: req.file.path,
      outputFileName: (isZip || splitOddEven) ? `${originalName}_converted.zip` : `${originalName}.pdf`,
      createdAt: Date.now(),
      isZip,
      options: { makeEven, splitOddEven }
    };

    convertJobs.set(jobId, job);
    this.processConversion(jobId);
    res.status(202).json({ success: true, message: '任务已提交', jobId });
  }

  public async uploadChunk(req: Request, res: Response) {
    const { uploadId, index, total, fileName, makeEven, splitOddEven } = req.body;
    const chunk = req.file;
    if (!chunk) return res.status(400).json({ success: false, message: '无数据' });

    const chunkDir = path.join(os.tmpdir(), `chunks_${uploadId}`);
    if (!fs.existsSync(chunkDir)) fs.mkdirSync(chunkDir, { recursive: true });
    fs.renameSync(chunk.path, path.join(chunkDir, `${index}`));

    if (fs.readdirSync(chunkDir).length === parseInt(total)) {
      const finalPath = path.join(os.tmpdir(), `up_${uploadId}_${fileName}`);
      const writeStream = fs.createWriteStream(finalPath);
      for (let i = 0; i < parseInt(total); i++) {
        const p = path.join(chunkDir, `${i}`);
        writeStream.write(fs.readFileSync(p));
        fs.unlinkSync(p);
      }
      writeStream.end();
      writeStream.on('finish', () => {
        fs.rmSync(chunkDir, { recursive: true, force: true });
        const job: ConvertJob = {
          id: uploadId,
          status: 'pending',
          inputPath: finalPath,
          outputFileName: (fileName.toLowerCase().endsWith('.zip') || splitOddEven === 'true') ? `${path.parse(fileName).name}_converted.zip` : `${path.parse(fileName).name}.pdf`,
          createdAt: Date.now(),
          isZip: fileName.toLowerCase().endsWith('.zip'),
          options: { makeEven: makeEven === 'true', splitOddEven: splitOddEven === 'true' }
        };
        convertJobs.set(uploadId, job);
        this.processConversion(uploadId);
      });
      return res.json({ success: true, jobId: uploadId, merged: true });
    }
    res.json({ success: true, merged: false });
  }

  private async processConversion(jobId: string) {
    const job = convertJobs.get(jobId);
    if (!job) return;
    job.status = 'processing';
    const tempDir = path.join(os.tmpdir(), `job_${jobId}`);
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      if (job.isZip) {
        await this.handleZipProcessing(job, tempDir);
      } else {
        await this.handleSingleFileProcessing(job, tempDir);
      }
      if (job.outputPath && fs.existsSync(job.outputPath)) {
        job.outputSize = fs.statSync(job.outputPath).size;
      }
      job.token = generateDownloadToken('anonymous');
      job.status = 'completed';
    } catch (error: any) {
      job.status = 'failed';
      job.error = error.message;
    } finally {
      if (fs.existsSync(job.inputPath)) fs.unlinkSync(job.inputPath);
      convertJobs.set(jobId, job);
    }
  }

  private async handleSingleFileProcessing(job: ConvertJob, tempDir: string) {
    const pdfPath = await this.convertWithRetry(job.inputPath, tempDir, job.options?.makeEven || false);
    
    if (job.options?.splitOddEven) {
      const { oddPath, evenPath } = await this.splitPdfOddEven(pdfPath);
      const zip = new AdmZip();
      const baseName = path.parse(job.inputPath).name;
      zip.addLocalFile(oddPath, '', `${baseName}_奇数页.pdf`);
      zip.addLocalFile(evenPath, '', `${baseName}_偶数页.pdf`);
      const zipPath = path.join(tempDir, job.outputFileName);
      zip.writeZip(zipPath);
      job.outputPath = zipPath;
    } else {
      job.outputPath = pdfPath;
    }
  }

  private async handleZipProcessing(job: ConvertJob, tempDir: string) {
    const unzipDir = path.join(tempDir, 'unzip');
    const outputDir = path.join(tempDir, 'output');
    fs.mkdirSync(unzipDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });

    const zip = new AdmZip(job.inputPath);
    zip.extractAllTo(unzipDir, true);

    const convertFiles: string[] = [];
    const keepFiles: { fullPath: string; relativePath: string }[] = [];
    const walk = (dir: string) => {
      fs.readdirSync(dir).forEach(file => {
        const full = path.join(dir, file);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (file.toLowerCase().endsWith('.docx') && !file.startsWith('~$')) convertFiles.push(full);
        else if (file.toLowerCase().endsWith('.pdf')) keepFiles.push({ fullPath: full, relativePath: path.relative(unzipDir, full) });
      });
    };
    walk(unzipDir);

    const limit = pLimit(CONCURRENCY_LIMIT);
    const outZip = new AdmZip();

    await Promise.all(convertFiles.map(file => limit(async () => {
      const pdf = await this.convertWithRetry(file, outputDir, job.options?.makeEven || false);
      const relDir = path.dirname(path.relative(unzipDir, file));
      const base = path.parse(file).name;

      if (job.options?.splitOddEven) {
        const { oddPath, evenPath } = await this.splitPdfOddEven(pdf);
        outZip.addLocalFile(oddPath, relDir === '.' ? '' : relDir, `${base}_奇数页.pdf`);
        outZip.addLocalFile(evenPath, relDir === '.' ? '' : relDir, `${base}_偶数页.pdf`);
      } else {
        outZip.addLocalFile(pdf, relDir === '.' ? '' : relDir);
      }
    })));

    for (const keep of keepFiles) {
      outZip.addLocalFile(keep.fullPath, path.dirname(keep.relativePath) === '.' ? '' : path.dirname(keep.relativePath));
    }

    const finalPath = path.join(tempDir, job.outputFileName);
    outZip.writeZip(finalPath);
    job.outputPath = finalPath;
  }

  private async splitPdfOddEven(pdfPath: string): Promise<{ oddPath: string; evenPath: string }> {
    const pdfBytes = fs.readFileSync(pdfPath);
    const srcDoc = await PDFDocument.load(pdfBytes);
    const oddDoc = await PDFDocument.create();
    const evenDoc = await PDFDocument.create();

    const pageIndices = srcDoc.getPageIndices();
    const oddIndices = pageIndices.filter(i => (i + 1) % 2 !== 0);
    const evenIndices = pageIndices.filter(i => (i + 1) % 2 === 0);

    const oddPages = await oddDoc.copyPages(srcDoc, oddIndices);
    oddPages.forEach(p => oddDoc.addPage(p));
    
    const evenPages = await evenDoc.copyPages(srcDoc, evenIndices);
    evenPages.forEach(p => evenDoc.addPage(p));

    const oddPath = pdfPath.replace('.pdf', '_odd.pdf');
    const evenPath = pdfPath.replace('.pdf', '_even.pdf');
    fs.writeFileSync(oddPath, await oddDoc.save());
    fs.writeFileSync(evenPath, await evenDoc.save());

    return { oddPath, evenPath };
  }

  private async convertWithRetry(docxPath: string, outDir: string, makeEven: boolean): Promise<string> {
    for (let i = 0; i <= 2; i++) {
      try {
        const profileDir = path.join(os.tmpdir(), `libre_${uuidv4()}`);
        await execAsync(`libreoffice -env:UserInstallation=file://${profileDir} --headless --convert-to pdf --outdir "${outDir}" "${docxPath}"`);
        if (fs.existsSync(profileDir)) fs.rmSync(profileDir, { recursive: true, force: true });
        
        const pdfPath = path.join(outDir, `${path.parse(docxPath).name}.pdf`);
        if (!fs.existsSync(pdfPath)) throw new Error('PDF missing');

        if (makeEven) {
          const doc = await PDFDocument.load(fs.readFileSync(pdfPath));
          if (doc.getPageCount() % 2 !== 0) {
            doc.addPage();
            fs.writeFileSync(pdfPath, await doc.save());
          }
        }
        return pdfPath;
      } catch (e) { if (i === 2) throw e; await new Promise(r => setTimeout(r, 1000)); }
    }
    return '';
  }

  public getStatus(req: Request, res: Response) {
    const jobId = req.params.jobId as string;
    const job = convertJobs.get(jobId);
    if (!job) return res.status(404).json({ success: false });
    res.json({ success: true, jobId: job.id, status: job.status, outputFileName: job.outputFileName, outputSize: job.outputSize, downloadToken: job.token, error: job.error });
  }

  public downloadFile(req: Request, res: Response) {
    const jobId = req.params.jobId as string;
    const job = convertJobs.get(jobId);
    if (!job || job.token !== req.query.token) return res.status(403).json({ success: false });
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(job.outputFileName)}"`);
    res.sendFile(path.resolve(job.outputPath!));
  }
}

export const convertController = new ConvertController();
