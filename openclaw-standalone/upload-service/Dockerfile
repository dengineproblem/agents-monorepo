FROM node:20-alpine
WORKDIR /app
RUN mkdir -p uploads
COPY package.json ./
RUN npm install --production
COPY index.js ./
EXPOSE 3001
CMD ["node", "index.js"]
