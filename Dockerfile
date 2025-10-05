FROM mcr.microsoft.com/playwright:v1.55.1-jammy

WORKDIR /app

# Use lockfile for deterministic installs
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .

ENV PORT=10000
EXPOSE 10000

CMD ["npm","start"]
