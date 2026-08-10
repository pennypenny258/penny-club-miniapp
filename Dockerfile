FROM node:22-bookworm-slim

# 镜像缺少控制台变量时只能进入生产初始化锁定态：健康检查可用，但不开放任何演示或业务接口。
# 匿名 staging 必须在测试服务中显式覆盖为 cloudbase_staging_demo；正式能力也必须逐项完成后再启用。
ENV NODE_ENV=production \
    DEPLOYMENT_PROFILE=cloudbase_production_bootstrap \
    DEMO_DATA_ONLY=false \
    DATA_REPOSITORY=production_bootstrap_disabled \
    PORT=3000
WORKDIR /app

# 只复制浏览器 MVP 运行所需的代码；本机配置、私有附件和原生小程序不进入镜像。
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable \
    && corepack prepare pnpm@11.9.0 --activate \
    && pnpm install --prod --frozen-lockfile
COPY --chown=node:node server ./server
COPY --chown=node:node templates ./templates

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["npm", "start"]
