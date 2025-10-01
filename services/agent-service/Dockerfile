FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm i
COPY tsconfig.json ./tsconfig.json
COPY src ./src
RUN npm run build
RUN mkdir -p dist/actions && cp src/actions/manifest.json dist/actions/manifest.json
ENV NODE_ENV=production
EXPOSE 8080
CMD ["npm","start"]
