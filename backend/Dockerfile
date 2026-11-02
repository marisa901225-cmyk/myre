FROM node:20-bookworm AS build

WORKDIR /app

# better-sqlite3 can require native compilation depending on NAS CPU/Node combo.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV DB_PATH=/data/data.db
ENV TZ=Asia/Seoul

COPY --from=build /app /app

RUN mkdir -p /data

EXPOSE 4000

CMD ["node", "server.js"]
