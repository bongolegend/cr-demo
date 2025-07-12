#!/bin/bash

echo "🗑️  Clearing database..."

# Drop all tables, triggers, and indexes (in correct order due to foreign key constraints)
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS users CASCADE;
"

echo "✅ Database cleared!" 