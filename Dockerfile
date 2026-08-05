FROM node:22-bookworm-slim

# 这份镜像专用于 CloudBase 测试部署。即使控制台漏填环境变量，也必须安全降级为匿名演示。
# CloudBase 服务级同名变量优先于镜像默认值；正式环境必须使用独立配置并通过 release:check。
ENV NODE_ENV=staging \
    DEPLOYMENT_PROFILE=cloudbase_staging_demo \
    DEMO_DATA_ONLY=true \
    PORT=3000
WORKDIR /app

# 只复制浏览器 MVP 运行所需的代码；本机配置、私有附件和原生小程序不进入镜像。
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node templates ./templates

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["npm", "start"]
