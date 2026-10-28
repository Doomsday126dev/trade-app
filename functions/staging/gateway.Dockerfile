FROM node:24-bookworm-slim
WORKDIR /app
COPY functions/e1-gateway/package.json functions/e1-gateway/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY functions ./functions
COPY staging ./staging
USER node
CMD ["node","functions/staging/gateway.entry.cjs"]
