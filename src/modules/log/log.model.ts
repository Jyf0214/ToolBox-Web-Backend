import mongoose, { Schema, Document } from 'mongoose';

export interface IAuditLog extends Document {
  action: string;
  module: string;
  ip?: string;
  userId?: string;
  details?: string;
  createdAt: Date;
}

const AuditLogSchema: Schema = new Schema({
  action: { type: String, required: true },
  module: { type: String, required: true, index: true },
  ip: { type: String },
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  details: { type: String },
}, { timestamps: { createdAt: true, updatedAt: false } });

export default mongoose.models.AuditLog || mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
