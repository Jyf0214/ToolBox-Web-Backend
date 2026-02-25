import { exec } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import util from 'util';

import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { PDFDocument } from 'pdf-lib';

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
  options?: {
    makeEven?: boolean;
  };
}

// 转换任务存储 (内存，生产环境应用 Redis)
const convertJobs = new Map<string, ConvertJob>();

/**
 * 文件转换控制器
 * docx -> pdf (使用 LibreOffice)
 */
export class ConvertController {
  /**
   * 处理 DOCX 转 PDF 请求
   */
  public docxToPdf(req: Request, res: Response, _next: NextFunction) {
    if (!req.file) {
      res.status(400).json({ success: false, message: '请上传文件' });
      return;
    }

    const jobId = uuidv4();
    const tempDir = os.tmpdir();
    const inputPath = req.file.path;
    const outputDir = path.join(tempDir, `output_${Date.now()}`);
    const originalName = path.parse(req.file.originalname).name;
    
    // 获取选项 (由于是 multipart/form-data，makeEven 可能是字符串 "true")
    const makeEven = req.body.makeEven === 'true' || req.body.makeEven === true;

    const job: ConvertJob = {
      id: jobId,
      status: 'pending',
      inputPath,
      outputFileName: `${originalName}.pdf`,
      createdAt: Date.now(),
      options: { makeEven }
    };

    convertJobs.set(jobId, job);

    // 异步处理转换
    this.processConversion(jobId, inputPath, outputDir, originalName, makeEven)
      .catch((error) => {
        console.error('转换出错:', error);
        const failedJob = convertJobs.get(jobId);
        if (failedJob) {
          failedJob.status = 'failed';
          failedJob.error = error instanceof Error ? error.message : '未知错误';
          convertJobs.set(jobId, failedJob);
        }
      });

    res.status(202).json({
      success: true,
      message: '转换任务已提交',
      jobId,
      statusUrl: `/api/convert/status/${jobId}`,
    });
  }

  /**
   * 处理转换任务
   */
  private async processConversion(
    jobId: string,
    inputPath: string,
    outputDir: string,
    originalName: string,
    makeEven: boolean
  ) {
    const job = convertJobs.get(jobId);
    if (!job) return;

    try {
      job.status = 'processing';
      convertJobs.set(jobId, job);

      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // 增强日志：打印执行命令
      const command = `libreoffice --headless --convert-to pdf --outdir "${outputDir}" "${inputPath}"`;
      console.log(`[Job ${jobId}] Executing: ${command}`);

      try {
        const { stdout, stderr } = await execAsync(command);
        if (stdout) console.log(`[Job ${jobId}] LibreOffice stdout: ${stdout}`);
        if (stderr) console.warn(`[Job ${jobId}] LibreOffice stderr: ${stderr}`);
      } catch (execError: any) {
        console.error(`[Job ${jobId}] Execution failed:`, execError.message);
        throw new Error(`LibreOffice 执行失败: ${execError.message}`);
      }

      // 获取生成的文件路径
      const files = fs.readdirSync(outputDir);
      const generatedFile = files.find(f => f.endsWith('.pdf'));
      const pdfPath = generatedFile ? path.join(outputDir, generatedFile) : null;

      if (!pdfPath || !fs.existsSync(pdfPath)) {
        console.error(`[Job ${jobId}] PDF not found in ${outputDir}. Files:`, files);
        throw new Error('转换失败：PDF 文件未生成');
      }

      // 补全偶数页逻辑
      if (makeEven) {
        console.log(`[Job ${jobId}] Checking page count for makeEven option...`);
        const pdfBytes = fs.readFileSync(pdfPath);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const pageCount = pdfDoc.getPageCount();
        
        if (pageCount % 2 !== 0) {
          console.log(`[Job ${jobId}] Odd pages found (${pageCount}), adding a blank page...`);
          pdfDoc.addPage();
          const modifiedPdfBytes = await pdfDoc.save();
          fs.writeFileSync(pdfPath, Buffer.from(modifiedPdfBytes));
          console.log(`[Job ${jobId}] Blank page added. New count: ${pdfDoc.getPageCount()}`);
        } else {
          console.log(`[Job ${jobId}] Already even pages (${pageCount}), skipping.`);
        }
      }

      // 生成一次性下载 token
      const token = generateDownloadToken('anonymous');
      job.status = 'completed';
      job.outputPath = pdfPath;
      job.token = token;
      convertJobs.set(jobId, job);
      console.log(`[Job ${jobId}] Conversion completed successfully`);

      // 清理临时输入文件
      if (fs.existsSync(inputPath)) {
        fs.unlinkSync(inputPath);
      }
    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : '未知错误';
      convertJobs.set(jobId, job);

      // 清理临时文件
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(outputDir)) fs.rmSync(outputDir, { recursive: true, force: true });
    }
  }

  /**
   * 查询转换状态
   */
  public getStatus(req: Request, res: Response) {
    const jobId = req.params.jobId as string;
    const job = convertJobs.get(jobId);

    if (!job) {
      res.status(404).json({
        success: false,
        message: '未找到转换任务',
      });
      return;
    }

    const response: {
      success: boolean;
      jobId: string;
      status: string;
      outputFileName: string;
      downloadToken?: string;
      downloadUrl?: string;
      error?: string;
    } = {
      success: true,
      jobId: job.id,
      status: job.status,
      outputFileName: job.outputFileName,
    };

    if (job.status === 'completed' && job.token) {
      response.downloadToken = job.token;
      response.downloadUrl = `/api/convert/download/${jobId}?token=${job.token}`;
    }

    if (job.status === 'failed') {
      response.error = job.error;
    }

    res.json(response);
  }

  /**
   * 下载转换后的文件 (需要 token 验证)
   */
  public downloadFile(req: Request, res: Response) {
    const jobId = req.params.jobId as string;
    const token = req.query.token as string;

    const job = convertJobs.get(jobId);

    if (!job) {
      res.status(404).json({
        success: false,
        message: '未找到转换任务',
      });
      return;
    }

    if (job.status !== 'completed') {
      res.status(400).json({
        success: false,
        message: '文件尚未转换完成',
      });
      return;
    }

    if (!token || !job.token || token !== job.token) {
      res.status(403).json({
        success: false,
        message: '下载凭证无效或已失效',
      });
      return;
    }

    if (!job.outputPath || !fs.existsSync(job.outputPath)) {
      res.status(404).json({
        success: false,
        message: '文件不存在或已过期',
      });
      return;
    }

    // 修复中文文件名乱码：使用 RFC 6266 标准编码，并添加详细日志
    const encodedFileName = encodeURIComponent(job.outputFileName).replace(/['()]/g, escape).replace(/\*/g, '%2A');
    const contentDisposition = `attachment; filename="${encodeURIComponent(job.outputFileName)}"; filename*=UTF-8''${encodedFileName}`;
    
    res.setHeader('Content-Disposition', contentDisposition);
    res.setHeader('Content-Type', 'application/pdf');

    console.log(`[Job ${jobId}] Starting download: ${job.outputFileName}`);
    console.log(`[Job ${jobId}] Header set: ${contentDisposition}`);

    // 使用 sendFile 替代 download 以防止 Header 被 Express 内部重写
    res.sendFile(path.resolve(job.outputPath), (err) => {
      if (err) {
        console.error(`[Job ${jobId}] Download failed:`, err);
      } else {
        console.log(`[Job ${jobId}] Download successful, cleaning up...`);
      }
      
      // 无论成功失败都执行清理
      if (job.outputPath && fs.existsSync(job.outputPath)) {
        fs.unlinkSync(job.outputPath);
      }
      const outputDir = path.dirname(job.outputPath!);
      if (fs.existsSync(outputDir)) {
        fs.rmSync(outputDir, { recursive: true, force: true });
      }
      convertJobs.delete(jobId);
    });
  }
}

export const convertController = new ConvertController();
