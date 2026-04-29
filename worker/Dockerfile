FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app

# Install worker dependencies
COPY worker/package*.json ./worker/
RUN cd worker && npm ci --ignore-scripts

# Install playwright browsers
RUN cd worker && npx playwright install chromium --with-deps

# Copy scraper source (worker imports from ../../src/scrapers)
COPY src/scrapers ./src/scrapers
COPY src/lib/prisma.ts ./src/lib/prisma.ts
COPY prisma ./prisma

# Copy worker source
COPY worker/src ./worker/src
COPY worker/tsconfig.json ./worker/

# Generate Prisma client
RUN cd worker && npx prisma generate --schema=../prisma/schema.prisma 2>/dev/null || true

EXPOSE 8080

WORKDIR /app/worker

CMD ["npm", "start"]
