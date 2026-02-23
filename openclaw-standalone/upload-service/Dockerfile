FROM node:22-alpine
WORKDIR /app
RUN mkdir -p /tmp/openclaw-uploads
COPY package.json ./
RUN npm install --production
COPY index.js ./
EXPOSE 3001
CMD ["node", "index.js"]
