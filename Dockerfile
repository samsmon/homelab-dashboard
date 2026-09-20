# ==========================================
# Multi-Stage Dockerfile for Homelab Cockpit
# Ultra-lightweight & Production Ready
# ==========================================

# Stage 1: Build Frontend SPA
FROM node:22-alpine AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: Build Backend Daemon
FROM node:22-alpine AS server-builder
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

# Stage 3: Production Minimal Runner
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# git + docker CLI (talks to the host's dockerd over the mounted socket, aka
# "docker outside of docker") back the Git Projects pull/rebuild feature.
# rclone backs scheduled/on-demand backup and restore. unzip backs config
# import (extracts only two named files from a small downloaded archive).
# tini acts as PID 1 to reap zombie processes and forward signals properly.
# gdu backs the on-demand Disk Usage Explorer (manual scan button, not
# polled) - a parallel directory walker, since this is ext4/spinning HDDs,
# not NTFS, so there is no WizTree-style MFT shortcut available.
RUN apk add --no-cache git docker-cli docker-cli-compose unzip tini gdu

# Install production dependencies only
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# Copy compiled backend & frontend assets
COPY --from=server-builder /app/server/dist ./server/dist
COPY --from=client-builder /app/client/dist ./client/dist

# Expose Cockpit Web Port
EXPOSE 3000

# Run Server with tini as init process to reap zombie processes
WORKDIR /app/server
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
