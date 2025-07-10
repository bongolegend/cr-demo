#!/bin/bash

# Database connection details from environment variables
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME}"
DB_USER="${DB_USER}"
DB_PASSWORD="${DB_PASSWORD}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Running PostgreSQL migrations...${NC}"

# Validate required environment variables
if [ -z "$DB_NAME" ]; then
    echo -e "${RED}Error: DB_NAME environment variable is required${NC}"
    exit 1
fi

if [ -z "$DB_USER" ]; then
    echo -e "${RED}Error: DB_USER environment variable is required${NC}"
    exit 1
fi

if [ -z "$DB_PASSWORD" ]; then
    echo -e "${RED}Error: DB_PASSWORD environment variable is required${NC}"
    exit 1
fi

echo -e "${YELLOW}Database: ${DB_HOST}:${DB_PORT}/${DB_NAME}${NC}"
echo -e "${YELLOW}User: ${DB_USER}${NC}"

# Check if PostgreSQL is running
if ! pg_isready -h $DB_HOST -p $DB_PORT -U $DB_USER > /dev/null 2>&1; then
    echo -e "${RED}Error: PostgreSQL is not running or not accessible${NC}"
    echo "Make sure to start the database with: docker-compose up -d"
    exit 1
fi

# Get the migrations directory
MIGRATIONS_DIR="$(dirname "$0")/migrations"

# Check if migrations directory exists
if [ ! -d "$MIGRATIONS_DIR" ]; then
    echo -e "${RED}Error: Migrations directory not found at $MIGRATIONS_DIR${NC}"
    exit 1
fi

# Find all .sql files in migrations directory and sort them
MIGRATION_FILES=$(find "$MIGRATIONS_DIR" -name "*.sql" | sort)

if [ -z "$MIGRATION_FILES" ]; then
    echo -e "${YELLOW}No migration files found in $MIGRATIONS_DIR${NC}"
    exit 0
fi

echo -e "${YELLOW}Found migration files:${NC}"
echo "$MIGRATION_FILES"
echo

# Run each migration file
for migration_file in $MIGRATION_FILES; do
    echo -e "${YELLOW}Running migration: $(basename "$migration_file")${NC}"
    
    # Run the migration
    if PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f "$migration_file" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Successfully ran $(basename "$migration_file")${NC}"
    else
        echo -e "${RED}✗ Failed to run $(basename "$migration_file")${NC}"
        echo "You can run it manually with:"
        echo "PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f \"$migration_file\""
        exit 1
    fi
done

echo -e "${GREEN}All migrations completed successfully!${NC}" 