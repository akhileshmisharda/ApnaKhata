# Use official Node.js 20 LTS on Debian Bookworm
FROM node:20-bookworm-slim

# Install Chromium and Indic fonts for Debian 12 Bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-indic \
    fonts-freefont-ttf \
    fonts-liberation \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Tell Puppeteer to use the installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    PORT=8080

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application code
COPY . .

# Expose Cloud Run default port
EXPOSE 8080

# Start the Express server
CMD ["npm", "start"]
