# syntax=docker/dockerfile:1
# check=skip=SecretsUsedInArgOrEnv
# (VITE_SUPABASE_ANON_KEY is a public key by design - it ships in the client bundle, so passing it as a
#  build arg is intentional, not a leaked secret. The BuildKit check flags it generically; skip it here.)
#
# Single-origin production image: one Node process serves the built client (dist/), the Hono API, and the
# /ws socket (see server/api/index.ts). The server runs via tsx (it imports .ts from src/ and server/
# directly), so we ship sources rather than a compiled bundle - simplest and correct for now; a bundled
# server is a later size optimization. Build-time VITE_* args are baked into the client; runtime config
# (DATABASE_URL, SUPABASE_*) comes from the host's env/secrets.

# --- build: install everything and produce dist/ ---
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
# Vite bakes these at build time (import.meta.env), so they must be present for `yarn build`, not at run.
ARG VITE_DAW_API_URL
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_DAW_API_URL=$VITE_DAW_API_URL \
    VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN yarn build

# --- runner: dist/ + sources + node_modules, run the server ---
FROM node:22-slim AS runner
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production \
    API_PORT=8080
# node_modules carries tsx (the runtime) + the server's deps; build and runner share the base image, so
# copying the installed tree across stages is safe.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/package.json /app/yarn.lock ./
COPY --from=build /app/tsconfig.json /app/tsconfig.app.json /app/tsconfig.node.json /app/tsconfig.server.json ./
COPY --from=build /app/drizzle.config.ts ./
EXPOSE 8080
# Run tsx directly, NOT via `yarn start`: the runner stage has no corepack cache, so invoking `yarn` here
# makes corepack download yarn on every boot (a network fetch + multi-second delay) - fatal for
# scale-to-zero, where it repeats on every cold start. The tsx bin needs no yarn. It runs
# server/api/index.ts: apply migrations, then serve API + client + /ws on API_PORT.
CMD ["node_modules/.bin/tsx", "server/api/index.ts"]
