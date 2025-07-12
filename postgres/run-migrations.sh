#!/bin/bash

echo "Running migrations..."

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Run all .sql files in migrations directory
for file in "$SCRIPT_DIR"/migrations/*.sql; do
  echo "Running: $(basename "$file")"
  PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f "$file"
done

echo "✅ Migrations completed!" 