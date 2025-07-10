#!/bin/bash

echo "Running migrations..."

# Run all .sql files in migrations directory
for file in ./migrations/*.sql; do
  echo "Running: $(basename "$file")"
  PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f "$file"
done

echo "✅ Migrations completed!" 