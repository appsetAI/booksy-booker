FROM mcr.microsoft.com/playwright:v1.47.1-jammy
WORKDIR /app
COPY package*.json ./
# was: RUN npm ci
RUN npm install --omit=dev
COPY . .
EXPOSE 8080
CMD ["npm","start"]
