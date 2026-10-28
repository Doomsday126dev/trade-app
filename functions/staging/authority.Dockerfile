FROM node:24-bookworm-slim
WORKDIR /app
COPY functions/e1-authority-service/package.json functions/e1-authority-service/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY functions ./functions
USER node
CMD ["node","functions/staging/authority.entry.cjs"]
