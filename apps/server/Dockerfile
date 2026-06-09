# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY turbo.json ./
COPY tsconfig.json ./
COPY apps/server/package.json ./apps/server/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies (including devDependencies for TS build)
RUN npm ci

# Copy source code
COPY packages/shared ./packages/shared
COPY apps/server ./apps/server

# Build shared library first, then server (bypass turbo lint issues)
RUN cd packages/shared && npx tsc
RUN cd apps/server && npx tsc

# Stage 2: Production Runner
FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
COPY apps/server/package.json ./apps/server/
COPY packages/shared/package.json ./packages/shared/

# Install only production dependencies
RUN npm ci --omit=dev

# Copy built code from builder stage
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY apps/server/.env ./apps/server/.env

EXPOSE 3001
WORKDIR /app/apps/server
CMD ["node", "--dns-result-order=ipv4first", "dist/index.js"]
