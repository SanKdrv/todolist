FROM node:24-alpine

WORKDIR /app

# Install dependencies from the lockfile first; source changes do not
# invalidate this layer.
COPY package.json package-lock.json ./
RUN npm ci

# Application sources; in dev this directory is replaced by a bind mount.
COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
