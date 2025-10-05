FROM mcr.microsoft.com/playwright:v1.55.1-jammy

WORKDIR /app

# Copy manifests (works with or without lockfile)
COPY package*.json ./

# Use npm ci when lockfile exists; otherwise npm install
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --no-audit --no-fund ; \
    else \
      npm install --omit=dev --no-audit --no-fund ; \
    fi

COPY . .

ENV PORT=10000
EXPOSE 10000

CMD ["npm","start"]
