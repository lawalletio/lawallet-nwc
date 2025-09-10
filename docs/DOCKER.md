# Docker

https://hub.docker.com/repository/docker/masize/lawallet-nwc/general

## Build

```bash
# Get version from package.json
VERSION=$(node -p "require('./package.json').version")
docker buildx build -t masize/lawallet-nwc:${VERSION} . --platform linux/amd64,linux/arm64 --push
```

## Docker compose

```bash
docker-compose up -d
```
