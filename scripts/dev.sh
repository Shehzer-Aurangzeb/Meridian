#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting Meridian Development Environment${NC}"
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
  echo -e "${RED}❌ Error: Docker is not running!${NC}"
  echo -e "${YELLOW}Please start Docker Desktop and try again.${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Docker is running${NC}"

# Container configuration
CONTAINER_NAME="meridian-postgres"
POSTGRES_USER="postgres"
POSTGRES_PASSWORD="postgres"
POSTGRES_DB="meridian_db"
HOST_PORT="5433"

# Check if container exists
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  # Container exists, check if it's running
  if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo -e "${GREEN}✓ PostgreSQL container is already running${NC}"
  else
    echo -e "${YELLOW}Starting existing PostgreSQL container...${NC}"
    docker start $CONTAINER_NAME > /dev/null
    echo -e "${GREEN}✓ PostgreSQL container started${NC}"
  fi
else
  # Container doesn't exist, create it
  echo -e "${YELLOW}Creating PostgreSQL container...${NC}"
  docker run -d \
    --name $CONTAINER_NAME \
    -e POSTGRES_USER=$POSTGRES_USER \
    -e POSTGRES_PASSWORD=$POSTGRES_PASSWORD \
    -e POSTGRES_DB=$POSTGRES_DB \
    -p $HOST_PORT:5432 \
    postgres:16-alpine > /dev/null
  
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ PostgreSQL container created and started${NC}"
    # Wait for PostgreSQL to be ready
    echo -e "${YELLOW}Waiting for PostgreSQL to be ready...${NC}"
    sleep 3
  else
    echo -e "${RED}❌ Failed to create PostgreSQL container${NC}"
    exit 1
  fi
fi

echo ""
echo -e "${GREEN}Database: postgresql://postgres:postgres@localhost:5433/meridian_db${NC}"
echo ""
echo -e "${GREEN}Starting applications...${NC}"
echo -e "  📦 API:     http://localhost:3001"
echo -e "  🌐 Web:     http://localhost:3000"
echo ""

# Run both apps in parallel using pnpm
pnpm run dev:apps
