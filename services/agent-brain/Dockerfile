FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm i --omit=dev
COPY src ./src
ENV NODE_ENV=production
CMD ["node", "src/server.js"]
