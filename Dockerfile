# streamrelay — packaged with ffmpeg so relays actually run out of the box.
#
# Build:  docker build -t streamrelay .
# Plan:   docker run --rm -v "$PWD/examples:/cfg" streamrelay plan /cfg/copy-fanout.json
# Doctor: docker run --rm streamrelay doctor
# Relay:  docker run --rm --network host -v "$PWD:/cfg" streamrelay \
#           start live --config /cfg/examples/copy-fanout.json

# ---- build stage: compile TS -> dist/ ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm install
COPY cli.ts ./
COPY src ./src
COPY test ./test
RUN npm run build && npm test

# ---- runtime stage: node + ffmpeg only ----
FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Zero runtime deps: we only need the compiled JS and the manifest.
COPY package.json ./
COPY --from=build /app/dist ./dist
COPY examples ./examples
COPY docs ./docs
# Session state lives under HOME; keep it writable for non-root use.
ENV STREAMRELAY_HOME=/data
RUN ln -s /app/dist/cli.js /usr/local/bin/streamrelay && chmod +x /app/dist/cli.js
VOLUME ["/data"]
ENTRYPOINT ["node", "/app/dist/cli.js"]
CMD ["--help"]
