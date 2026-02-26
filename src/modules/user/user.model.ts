import mongoose, { Schema, Document } from 'mongoose';

export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN'
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  BANNED = 'BANNED'
}

export interface IUser extends Document {
  username: string;
  usernameLower: string;
  email?: string;
  password: string;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
  avatar?: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema: Schema = new Schema({
  username: { type: String, required: true },
  usernameLower: { type: String, required: true, unique: true, index: true },
  email: { type: String, unique: true, sparse: true },
  password: { type: String, required: true },
  role: { type: String, enum: Object.values(UserRole), default: UserRole.USER },
  status: { type: String, enum: Object.values(UserStatus), default: UserStatus.ACTIVE },
  emailVerified: { type: Boolean, default: false },
  avatar: { type: String },
}, { timestamps: true });

export default mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
