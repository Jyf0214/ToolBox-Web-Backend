# 阶段 1: 构建阶段
FROM node:20-alpine AS builder

WORKDIR /app

# 1. 复制依赖定义文件
COPY package*.json ./

# 2. 安装所有依赖
RUN npm install

# 3. 复制源代码并构建
COPY . .
RUN npm run build

# 阶段 2: 运行阶段
FROM node:20-alpine

# 设置时区和环境支持
ENV TZ=Asia/Shanghai \
    LANG=zh_CN.UTF-8 \
    LC_ALL=zh_CN.UTF-8

# 安装 LibreOffice 和中文字体 (修正包名)
RUN apk add --no-cache \
    tzdata \
    fontconfig \
    font-noto-cjk \
    libreoffice \
    udev \
    ttf-freefont \
    chromium \
    && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
    && echo "Asia/Shanghai" > /etc/timezone \
    && fc-cache -fv

WORKDIR /app

# 仅复制构建产物和必要的依赖
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma

# 暴露端口
EXPOSE 7860

# 强制 Node.js 不缓存日志输出 (实时刷新)
ENV NODE_ENV=production

# 启动命令：直接使用 node 启动，避免 npm 拦截日志
CMD ["node", "dist/server.js"]
