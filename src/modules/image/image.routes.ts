import { Router } from 'express';
import { imageController } from './image.controller';
import { verifyToken } from '../../shared/middlewares/auth.middleware';
import { audit } from '../../shared/middlewares/audit.middleware';

const router = Router();

router.get('/', verifyToken, (req, res, next) => imageController.getImages(req, res, next));
router.post('/', verifyToken, audit('UPLOAD_IMAGE', 'IMAGE'), (req, res, next) => imageController.createImage(req, res, next));
router.delete('/:id', verifyToken, audit('DELETE_IMAGE', 'IMAGE'), (req, res, next) => imageController.deleteImage(req, res, next));

export default router;
