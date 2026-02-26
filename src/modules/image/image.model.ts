import mongoose, { Schema, Document } from 'mongoose';

export interface IImage extends Document {
  title: string;
  category: string;
  url: string;
  userId: string;
  createdAt: Date;
}

const ImageSchema: Schema = new Schema({
  title: { type: String, required: true },
  category: { type: String, default: 'default', index: true },
  url: { type: String, required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

export default mongoose.models.Image || mongoose.model<IImage>('Image', ImageSchema);
