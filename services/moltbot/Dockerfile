FROM node:22

# Install system dependencies (делается один раз при сборке образа)
RUN apt-get update && apt-get install -y \
    git \
    ca-certificates \
    python3 \
    make \
    g++ \
    curl \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Configure Git
RUN git config --global --replace-all url."https://github.com/".insteadOf "ssh://git@github.com/" \
    && git config --global --add url."https://github.com/".insteadOf "git@github.com:"

# Install moltbot globally (делается один раз при сборке образа)
RUN npm install -g moltbot@beta

WORKDIR /root/clawd

# Точка входа - только setup и запуск, без установки зависимостей
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
