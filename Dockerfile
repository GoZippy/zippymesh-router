# ZippyMesh LLM Router — Production Dockerfile (Alpha v0.1.0)
# Multi-stage build: source code not exposed in final image

# Stage 1: Builder (source code + build)
FROM node:20-alpine AS builder

WORKDIR /build

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy only package files
COPY package*.json ./

# Install dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Set dummy secrets for build (production secrets set at runtime)
ENV JWT_SECRET=build_time_placeholder
ENV ZIPPY_API_KEY=build_time_placeholder

# Build Next.js production bundle (.next/standalone = source-free binary)
RUN npm run build

# Stage 2: Runtime (binary only, no source code visible)
FROM node:20-alpine

LABEL maintainer="BookingBill <dev@zippymesh.io>"
LABEL description="ZippyMesh LLM Router - Multi-provider LLM routing with ZippyCoin integration (Alpha)"
LABEL version="0.1.0-alpha"
LABEL org.opencontainers.image.source="https://github.com/BookingBill/ZippyMesh_LLM_Router"

WORKDIR /app

# Install runtime dependencies only
RUN apk add --no-cache dumb-init curl && \
    addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy ONLY the production build from builder
# .next/standalone contains compiled app (source code NOT visible)
COPY --from=builder --chown=nodejs:nodejs /build/.next/standalone ./
COPY --from=builder --chown=nodejs:nodejs /build/public ./public
COPY --from=builder --chown=nodejs:nodejs /build/.next/static ./.next/static

# Copy only production dependencies
COPY --from=builder /build/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force && chown -R nodejs:nodejs /app

# Create data directory
RUN mkdir -p /app/data && chown nodejs:nodejs /app/data

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 20128

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:20128/api/health || exit 1

# Environment variables (can be overridden at runtime)
ENV NODE_ENV=production
ENV ZIPPY_PORT=20128
ENV DATA_DIR=/app/data
ENV NEXT_TELEMETRY_DISABLED=1

# Use dumb-init to handle signals properly
ENTRYPOINT ["/sbin/dumb-init", "--"]

# Start production server (using standalone server.js)
CMD ["node", "server.js"]
