# ---------- Etapa 1: compilar TypeScript ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---------- Etapa 2: imagen final (solo lo necesario para correr) ----------
FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY proto ./proto
COPY contracts ./contracts
# Los secretos (DATABASE_URL, JWT_SECRET, SERVICE_API_KEY...) NO van aqui: se pasan al ejecutar el contenedor.
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/v2/alojamientos/health || exit 1
CMD ["node", "dist/main"]
