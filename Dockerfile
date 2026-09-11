# Use official Node.js LTS slim image
FROM node:20-bullseye-slim

# Install latest Chrome dependencies & fonts for Google Cloud Run
RUN apt-get update \
    && apt-get install -y wget gnupg ca-certificates \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/googlechrome-linux-keyring.gpg \
    && sh -c 'echo "deb [arch=amd64 signed-by=/usr/share/keyrings/googlechrome-linux-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf fonts-indic libxss1 \
      --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Tell Puppeteer to use the installed Google Chrome
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome \
    NODE_ENV=production \
    PORT=8080

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source code
COPY . .

# Expose Cloud Run default port
EXPOSE 8080

# Start Express service
CMD ["npm", "start"]
