FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY apps ./apps
COPY db ./db
COPY scripts ./scripts
COPY tests ./tests
USER node
CMD ["node", "apps/marajut/server.js"]
