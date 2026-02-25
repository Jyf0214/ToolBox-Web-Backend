import { exec } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import util from 'util';

import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

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

    const job: ConvertJob = {
      id: jobId,
      status: 'pending',
      inputPath,
      outputFileName: `${originalName}.pdf`,
      createdAt: Date.now(),
    };

    convertJobs.set(jobId, job);

    // 异步处理转换
    this.processConversion(jobId, inputPath, outputDir, originalName)
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
    originalName: string
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

      // 获取生成的文件路径 (处理 LibreOffice 可能改变文件名的情况)
      const files = fs.readdirSync(outputDir);
      const generatedFile = files.find(f => f.endsWith('.pdf'));
      const pdfPath = generatedFile ? path.join(outputDir, generatedFile) : null;

      if (!pdfPath || !fs.existsSync(pdfPath)) {
        console.error(`[Job ${jobId}] PDF not found in ${outputDir}. Files:`, files);
        throw new Error('转换失败：PDF 文件未生成');
      }

      // 生成一次性下载 token
      const token = generateDownloadToken('anonymous');
      job.status = 'completed';
      job.outputPath = pdfPath;
      job.token = token;
      convertJobs.set(jobId, job);
      console.log(`[Job ${jobId}] Conversion completed successfully`);
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

    // 发送文件并清理
    res.download(job.outputPath, job.outputFileName, () => {
      // 下载完成后清理
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
