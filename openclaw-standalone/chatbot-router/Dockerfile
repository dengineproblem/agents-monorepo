FROM node:22-slim

WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY index.js ./

USER node
EXPOSE 3002
CMD ["node", "index.js"]
