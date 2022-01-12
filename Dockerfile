FROM node:16.13.1-alpine3.14
RUN apk update && apk add bash
RUN apk add dumb-init
ENV NODE_ENV=production
ENV DEBUG=lnrpc*
WORKDIR /app
COPY --chown=node:node ["package.json", "package-lock.json*", "./"]
RUN npm ci --production
COPY --chown=node:node ["grpc.js", "./node_modules/lnd-grpc/dist"]
COPY --chown=node:node . .
USER node
CMD ["dumb-init", "node", "index.js"]
