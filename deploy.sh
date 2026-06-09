#!/bin/bash
# IronHammer Deployment Script for EC2
# Run this on your EC2 instance

set -e

echo "=== IronHammer Deployment ==="

# 1. Navigate to repo
cd ~/DND-Game

# 2. Pull latest changes (if using git)
# git pull origin main

# 3. Copy the fixed types file
cp packages/shared/src/types/index.ts packages/shared/src/types/index.ts.bak 2>/dev/null || true
echo "Backup created (if existed)"

# 4. Build Docker image
echo "Building Docker image..."
docker build -t ironhammer-server -f apps/server/Dockerfile .

# 5. Stop and remove old container if running
if docker ps -q -f name=ironhammer | grep -q .; then
    echo "Stopping old container..."
    docker stop ironhammer
    docker rm ironhammer
fi

# 6. Run new container
echo "Starting new container..."
docker run -d \
  --name ironhammer \
  --restart unless-stopped \
  -p 3001:3001 \
  --env-file apps/server/.env \
  ironhammer-server

# 7. Check logs
echo "Container started. Showing logs (Ctrl+C to exit)..."
sleep 2
docker logs -f ironhammer
