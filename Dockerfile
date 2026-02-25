# 阶段 1: 构建阶段
FROM node:20-alpine AS builder

WORKDIR /app

# 1. 首先复制依赖定义文件以利用缓存
COPY package*.json ./
COPY prisma ./prisma/

# 2. 安装依赖 (如果 package.json 没变，这一步会从缓存读取)
RUN npm install

# 3. 复制源代码并构建
COPY . .
RUN npx prisma generate
RUN npm run build

# 阶段 2: 运行阶段
FROM node:20-alpine

# 设置时区和中文环境支持
ENV TZ=Asia/Shanghai \
    LANG=zh_CN.UTF-8 \
    LC_ALL=zh_CN.UTF-8

# 安装 LibreOffice, 时区数据, 字体配置工具和开源中文字体
RUN apk add --no-cache \
    tzdata \
    fontconfig \
    font-noto-sans-cjk \
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

# 启动命令
CMD ["npm", "start"]
