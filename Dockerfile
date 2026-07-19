FROM node:22-alpine

RUN apk add --no-cache python3 make g++ git

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY . .

RUN mkdir -p sessions

EXPOSE 8000

CMD ["node", "index.js"]
