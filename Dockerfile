# --- Resume Composer: single-stage Node.js image ---
# No frontend build step is needed since the client is plain HTML/CSS/JS,
# served statically by the same Express server that hosts the API.

FROM node:20-alpine

WORKDIR /app

# Install only production dependencies first for better layer caching
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source
COPY server.js ./
COPY public ./public

# Never bake secrets into the image — ANTHROPIC_API_KEY is injected
# at runtime via `docker run -e` / docker-compose / AWS App Runner env vars.
ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

# Basic container-level health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- http://localhost:8080/api/health || exit 1

CMD ["node", "server.js"]
