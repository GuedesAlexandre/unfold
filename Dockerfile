# Backend Unfold (API /api/run) pour un Space Docker Hugging Face.
# GHC doit être présent à l'exécution : chaque requête compile le programme envoyé.
FROM node:22-bookworm-slim AS node

FROM haskell:9.10.3-slim-bookworm

# Node.js (copié depuis l'image officielle).
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# Hugging Face lance le conteneur avec l'UID 1000.
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user
WORKDIR /home/user/app

# Instrumenteur Haskell (ses dépendances sont toutes des paquets livrés avec GHC).
COPY --chown=user tracer-haskell ./tracer-haskell
RUN cabal update \
 && cd tracer-haskell \
 && cabal build -v1 exe:unfold-instrument \
 && mkdir -p ../bin \
 && cp "$(cabal list-bin -v0 unfold-instrument)" ../bin/unfold-instrument \
 && rm -rf dist-newstyle

# Serveur Node.
COPY --chown=user package.json package-lock.json tsconfig.base.json ./
COPY --chown=user shared ./shared
COPY --chown=user server/package.json server/tsconfig.json ./server/
COPY --chown=user web/package.json ./web/
RUN npm ci -w server -w shared --include-workspace-root=false
COPY --chown=user server/src ./server/src

ENV UNFOLD_INSTRUMENT_BIN=/home/user/app/bin/unfold-instrument \
    HOST=0.0.0.0 \
    PORT=7860
EXPOSE 7860
WORKDIR /home/user/app/server
CMD ["npx", "tsx", "src/index.ts"]
