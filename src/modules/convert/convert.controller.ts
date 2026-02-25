import { Request, Response, NextFunction } from 'express';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import util from 'util';

const execAsync = util.promisify(exec);

/**
 * 文件转换控制器
 * docx -> pdf (使用 LibreOffice)
 */
export class ConvertController {
  /**
   * 处理 DOCX 转 PDF 请求
   */
  public async docxToPdf(req: Request, res: Response, next: NextFunction) {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '请上传文件' });
    }

    const tempDir = os.tmpdir();
    const inputPath = req.file.path;
    const outputDir = path.join(tempDir, `output_${Date.now()}`);
    
    try {
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

      // 调用 LibreOffice 命令行进行转换
      const command = `libreoffice --headless --convert-to pdf --outdir "${outputDir}" "${inputPath}"`;
      await execAsync(command);

      // 获取生成的文件路径
      const originalName = path.parse(req.file.originalname).name;
      const pdfPath = path.join(outputDir, `${originalName}.pdf`);

      if (fs.existsSync(pdfPath)) {
        res.download(pdfPath, `${originalName}.pdf`, (err) => {
          // 清理临时文件
          if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
          if (fs.existsSync(outputDir)) fs.rmSync(outputDir, { recursive: true, force: true });
        });
      } else {
        throw new Error('转换失败：PDF 文件未生成');
      }
    } catch (error) {
      console.error('转换出错:', error);
      next(error);
    }
  }
}

export const convertController = new ConvertController();
