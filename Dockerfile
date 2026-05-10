FROM node:22-alpine
WORKDIR /app

# Solo manifests primero — aprovecha el cache de Docker
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

# Resto del código
COPY . .

# Compilar TypeScript
RUN npm run build

# Limpiar devDependencies del runtime
RUN npm prune --omit=dev

EXPOSE 3000
CMD ["node", "dist/server.js"]
