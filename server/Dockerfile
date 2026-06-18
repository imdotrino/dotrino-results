FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
ENV PORT=8092
EXPOSE 8092
# Estado persistente (clave de servicio + overrides) en un volumen.
VOLUME ["/app/data"]
CMD ["node", "server.js"]
