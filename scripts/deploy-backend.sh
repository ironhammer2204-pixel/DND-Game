#!/bin/bash
# Deploy ONLY backend to AWS EC2

set -e

# Navigate to project root if script is run from scripts/
cd "$(dirname "$0")/.."

# Load environment variables if .env exists in server directory
if [ -f apps/server/.env ]; then
  # export variables excluding comments
  export $(grep -v '^#' apps/server/.env | xargs)
fi

EC2_IP="${EC2_IP:-YOUR_EC2_PUBLIC_IP}"
EC2_USER="${EC2_USER:-ec2-user}"
KEY_PATH="${KEY_PATH:-~/ironhammer-key.pem}"

echo "=== Building Backend ==="
npx turbo run build --filter=shared --filter=server
docker build -t ironhammer-server -f apps/server/Dockerfile .

echo "=== Saving Image ==="
docker save ironhammer-server | gzip > ironhammer-server.tar.gz

echo "=== Transferring to EC2 ==="
scp -i "$KEY_PATH" ironhammer-server.tar.gz "$EC2_USER@$EC2_IP:/home/ec2-user/"

echo "=== Deploying on EC2 ==="
ssh -i "$KEY_PATH" "$EC2_USER@$EC2_IP" << REMOTE
  # Load image
  docker load < ironhammer-server.tar.gz
  
  # Stop old container
  docker stop ironhammer 2>/dev/null || true
  docker rm ironhammer 2>/dev/null || true
  
  # Run new container
  docker run -d \
    --name ironhammer \
    --restart unless-stopped \
    -p 3001:3001 \
    -e PORT=3001 \
    -e NODE_ENV=production \
    -e DATABASE_URL="$DATABASE_URL" \
    -e SUPABASE_URL="$SUPABASE_URL" \
    -e SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" \
    -e SUPABASE_SERVICE_KEY="$SUPABASE_SERVICE_KEY" \
    -e FRONTEND_URL="$FRONTEND_URL" \
    -e GROQ_API_KEY="$GROQ_API_KEY" \
    ironhammer-server
  
  # Clean up
  rm ironhammer-server.tar.gz
REMOTE

# Clean up local tar
rm ironhammer-server.tar.gz

echo "=== Done ==="
echo "Backend running at: http://$EC2_IP:3001"
echo "Health check: http://$EC2_IP:3001/health"
