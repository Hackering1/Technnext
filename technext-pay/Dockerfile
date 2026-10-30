FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY src ./src
COPY db ./db
COPY scripts ./scripts
USER node
EXPOSE 3000
CMD ["node", "src/start-all.js"]
