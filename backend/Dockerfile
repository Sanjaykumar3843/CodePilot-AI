FROM node:20-alpine AS base

WORKDIR /app

# Install dependencies first for Docker layer caching
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application code
COPY server.js ./
COPY src/ ./src/
COPY data/ ./data/

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["node", "server.js"]

