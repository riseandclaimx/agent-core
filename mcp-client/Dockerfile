# Build stage
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# Production stage
FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY public/ ./public/
EXPOSE 3100
ENV PORT=3100
CMD ["node", "dist/server.js"]
