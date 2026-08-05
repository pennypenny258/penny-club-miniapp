FROM node:22-bookworm-slim

ENV PORT=3000
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
