# Static Astro site (see CLAUDE.md — "the site stays static"): there is no
# server to run, so the runtime stage is nginx serving `dist/`, not Node.
# PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY only need to exist at
# build time, the same requirement Netlify has (see netlify.toml).

# --- deps --------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY package.json pnpm-lock.yaml ./
# --prod: astro build doesn't need @astrojs/check, typescript or the other
# devDependencies — those are for `pnpm check` and `pnpm og`, run outside Docker.
RUN pnpm install --frozen-lockfile --prod

# --- builder -------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate
ARG PUBLIC_SUPABASE_URL
ARG PUBLIC_SUPABASE_ANON_KEY
ENV PUBLIC_SUPABASE_URL=$PUBLIC_SUPABASE_URL
ENV PUBLIC_SUPABASE_ANON_KEY=$PUBLIC_SUPABASE_ANON_KEY
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build
# Converts dist/_headers (Netlify format) into nginx location blocks — one
# CSP, derived once, reused by both deploy targets.
RUN node scripts/build-nginx-headers.mjs dist/_headers nginx-headers.conf

# --- runner ----------------------------------------------------------------
FROM nginx:1.27-alpine AS runner
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/nginx-headers.conf /etc/nginx/server-headers.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
