import { Request, Response, NextFunction } from 'express';
import { DatabaseManager } from '../../config/db.config';
import MongoImage from './image.model';

export class ImageController {
  public getImages = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { category } = req.query;
      const dbType = DatabaseManager.getType();
      let images = [];

      const filter: any = {};
      if (category) filter.category = category;

      if (dbType === 'mongodb') {
        images = await MongoImage.find(filter).sort({ createdAt: -1 });
      } else if (dbType === 'mysql') {
        images = await DatabaseManager.getPrisma().image.findMany({
          where: category ? { category: String(category) } : {},
          orderBy: { createdAt: 'desc' },
          include: { user: { select: { username: true } } }
        });
      }

      res.json({ success: true, data: images });
    } catch (error) {
      next(error);
    }
  };

  public createImage = async (req: any, res: Response, next: NextFunction) => {
    try {
      const { title, url, category } = req.body;
      const dbType = DatabaseManager.getType();
      const userId = req.user.id || req.user._id;

      let newImage;
      if (dbType === 'mongodb') {
        newImage = await MongoImage.create({ title, url, category, userId });
      } else if (dbType === 'mysql') {
        newImage = await DatabaseManager.getPrisma().image.create({
          data: { title, url, category, userId: Number(userId) }
        });
      }

      res.status(201).json({ success: true, data: newImage });
    } catch (error) {
      next(error);
    }
  };

  public deleteImage = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const dbType = DatabaseManager.getType();

      if (dbType === 'mongodb') {
        await MongoImage.findByIdAndDelete(id);
      } else if (dbType === 'mysql') {
        await DatabaseManager.getPrisma().image.delete({ where: { id: Number(id) } });
      }

      res.json({ success: true, message: '图片已删除' });
    } catch (error) {
      next(error);
    }
  };
}

export const imageController = new ImageController();
