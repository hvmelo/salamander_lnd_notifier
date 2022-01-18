FROM node:16.13.1-alpine3.14
RUN apk update && apk add bash
RUN apk add dumb-init
ENV NODE_ENV=production
ENV DEBUG=lnrpc*
WORKDIR /app
COPY ["package.json", "package-lock.json*", "./"]
RUN npm ci --production
COPY . .
CMD ["dumb-init", "node", "index.js"]
