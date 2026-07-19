# Build stage
FROM oven/bun:1.3 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build
# Prune to production dependencies for the runtime image.
RUN rm -rf node_modules && bun install --frozen-lockfile --production

# Runtime stage
FROM oven/bun:1.3
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/drizzle ./drizzle
# Blob volume mount point, owned by the unprivileged user the image ships with.
RUN mkdir -p /data/blobs && chown -R bun:bun /data/blobs /app
USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
	CMD bun -e "fetch('http://localhost:3000/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["bun", "build/index.js"]
