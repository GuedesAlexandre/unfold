# Backend Unfold (API /api/run) pour Render (offre gratuite : 512 Mo de RAM).
# GHC doit être présent à l'exécution : chaque requête compile le programme envoyé.

# --- 1. Compilation de l'instrumenteur ---------------------------------------
FROM haskell:9.10.3-slim-bookworm AS build
WORKDIR /src
COPY tracer-haskell ./tracer-haskell
RUN cabal update \
 && cd tracer-haskell \
 && cabal build -v1 exe:unfold-instrument \
 && cp "$(cabal list-bin -v0 unfold-instrument)" /unfold-instrument
# GHC sans bibliothèques de profilage ni documentation : l'image reste légère.
RUN find /opt/ghc -type f \( -name '*.p_hi' -o -name '*_p.a' -o -name '*.p_o' \) -delete \
 && rm -rf /opt/ghc/9.10.3/share/doc

# --- 2. Node ---------------------------------------------------------------------
FROM node:22-bookworm-slim AS node

# --- 3. Image finale -------------------------------------------------------------
FROM debian:bookworm-slim
ENV LANG=C.UTF-8
# GHC a besoin de gcc et de ces bibliothèques pour lier les programmes.
RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc libc6-dev libgmp-dev libffi-dev libnuma-dev libtinfo-dev zlib1g-dev \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /opt/ghc/9.10.3 /opt/ghc/9.10.3
COPY --from=build /unfold-instrument /usr/local/bin/unfold-instrument
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
ENV PATH=/opt/ghc/9.10.3/bin:$PATH

RUN useradd -m unfold
USER unfold
WORKDIR /home/unfold/app

COPY --chown=unfold package.json package-lock.json tsconfig.base.json ./
COPY --chown=unfold shared ./shared
COPY --chown=unfold server/package.json server/tsconfig.json ./server/
COPY --chown=unfold web/package.json ./web/
RUN npm ci -w server -w shared --include-workspace-root=false && npm cache clean --force
COPY --chown=unfold tracer-haskell/runtime ./tracer-haskell/runtime
COPY --chown=unfold server/src ./server/src

# Render fournit PORT (10000 par défaut). Limites de tas adaptées à 512 Mo de RAM.
ENV UNFOLD_INSTRUMENT_BIN=/usr/local/bin/unfold-instrument \
    UNFOLD_GHC_HEAP=300m \
    UNFOLD_PROG_HEAP=200m \
    HOST=0.0.0.0 \
    PORT=10000
EXPOSE 10000
WORKDIR /home/unfold/app/server
CMD ["npx", "tsx", "src/index.ts"]
