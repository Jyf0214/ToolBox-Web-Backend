# 阶段 1: 构建阶段
FROM node:20-alpine AS builder

WORKDIR /app

# 复制依赖定义
COPY package*.json ./
COPY prisma ./prisma/

# 安装所有依赖
RUN npm install

# 复制源代码并构建
COPY . .
RUN npx prisma generate
RUN npm run build

# 阶段 2: 运行阶段
FROM node:20-alpine

WORKDIR /app

# 仅复制构建产物和必要的依赖
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma

# 暴露端口
EXPOSE 3001

# 启动命令
CMD ["npm", "start"]
