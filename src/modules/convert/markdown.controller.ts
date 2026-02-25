import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import os from 'os';
import MarkdownIt from 'markdown-it';
import puppeteer from 'puppeteer';
import { generateDownloadToken } from '../../shared/middlewares/token.middleware';

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true
});

/**
 * Markdown 转 PDF 控制器
 */
export class MarkdownController {
  private static jobs = new Map<string, any>();

  public async convert(req: Request, res: Response) {
    const { content, title = 'document' } = req.body;
    
    if (!content) {
      return res.status(400).json({ success: false, message: '内容不能为空' });
    }

    const jobId = uuidv4();
    const tempDir = path.join(os.tmpdir(), `md_${jobId}`);
    fs.mkdirSync(tempDir, { recursive: true });

    // 提交响应，开始异步处理
    res.status(202).json({ success: true, jobId });

    this.processMdToPdf(jobId, content, title, tempDir).catch(err => {
      console.error(`[MD Job ${jobId}] Failed:`, err);
      MarkdownController.jobs.set(jobId, { status: 'failed', error: err.message });
    });
  }

  private async processMdToPdf(jobId: string, content: string, title: string, tempDir: string) {
    MarkdownController.jobs.set(jobId, { status: 'processing' });

    const htmlContent = md.render(content);
    const fullHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap" rel="stylesheet">
        <style>
          body { font-family: 'Inter', -apple-system, sans-serif; line-height: 1.6; color: #333; padding: 20px; }
          img { max-width: 100%; }
          pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow: auto; }
          code { font-family: monospace; background: rgba(175,184,193,0.2); padding: 0.2em 0.4em; border-radius: 6px; }
          table { border-collapse: collapse; width: 100%; margin: 16px 0; }
          th, td { border: 1px solid #d0d7de; padding: 6px 13px; }
          blockquote { border-left: 4px solid #d0d7de; color: #657d7d; padding-left: 16px; margin: 0; }
          @page { size: A4; margin: 2cm; }
        </style>
      </head>
      <body>
        ${htmlContent}
      </body>
      </html>
    `;

    // 使用系统 Chromium 启动 Puppeteer
    const browser = await puppeteer.launch({
      executablePath: '/usr/bin/chromium-browser', // Docker 中的路径
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
      const page = await browser.newPage();
      await page.setContent(fullHtml, { waitUntil: 'networkidle0' });
      
      const pdfPath = path.join(tempDir, `${title}.pdf`);
      await page.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: false
      });

      const token = generateDownloadToken('anonymous');
      MarkdownController.jobs.set(jobId, {
        status: 'completed',
        outputPath: pdfPath,
        outputFileName: `${title}.pdf`,
        token
      });
    } finally {
      await browser.close();
    }
  }

  public getStatus(req: Request, res: Response) {
    const jobId = req.params.jobId as string;
    const job = MarkdownController.jobs.get(jobId);
    if (!job) return res.status(404).json({ success: false });
    
    res.json({
      ...job,
      downloadUrl: job.status === 'completed' ? `/api/convert/md/download/${jobId}?token=${job.token}` : undefined
    });
  }

  public download(req: Request, res: Response) {
    const jobId = req.params.jobId as string;
    const token = req.query.token as string;
    const job = MarkdownController.jobs.get(jobId);

    if (!job || job.token !== token) return res.status(403).send('Forbidden');

    const encodedFileName = encodeURIComponent(job.outputFileName).replace(/['()]/g, escape).replace(/\*/g, '%2A');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(job.outputFileName).replace(/['()]/g, '')}"; filename*=UTF-8''${encodedFileName}`);
    res.sendFile(path.resolve(job.outputPath), () => {
      fs.rmSync(path.dirname(job.outputPath), { recursive: true, force: true });
      MarkdownController.jobs.delete(jobId);
    });
  }
}

export const markdownController = new MarkdownController();
