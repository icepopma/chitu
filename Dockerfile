# ===== Stage 1: 安装依赖 =====
FROM node:22-bookworm AS deps

WORKDIR /app

# 先复制 lock 文件，利用 Docker 层缓存
COPY package.json package-lock.json* ./
COPY web-ui/package.json web-ui/package-lock.json* ./web-ui/

# 安装后端依赖（含 devDependencies，build 需要）
RUN npm install --ignore-scripts

# 安装前端依赖
RUN cd web-ui && npm install --ignore-scripts

# ===== Stage 2: 构建 =====
FROM deps AS build

COPY . .

# 构建前端（Vite → web-ui/dist）
RUN cd web-ui && npm run build

# 构建后端（tsc → dist/）
RUN npm run build

# ===== Stage 3: 生产镜像 =====
FROM node:22-bookworm-slim AS production

WORKDIR /app

# 设置环境变量
ENV NODE_ENV=production

# 只复制生产依赖定义
COPY package.json package-lock.json* ./

# 只安装生产依赖
RUN npm install --omit=dev --ignore-scripts

# 复制构建产物
COPY --from=build /app/dist ./dist
COPY --from=build /app/web-ui/dist ./web-ui/dist

# 复制前端静态文件到后端可服务的目录（可选）
# 创建数据目录
RUN mkdir -p /app/chitu-data

EXPOSE 8080

CMD ["node", "dist/start-server.js"]
