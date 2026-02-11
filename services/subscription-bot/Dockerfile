FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm i
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
ENV NODE_ENV=production
EXPOSE 8087
CMD ["npm", "start"]
