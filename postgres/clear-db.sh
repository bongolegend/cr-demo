#!/bin/bash

echo "🗑️  Clearing database..."

# Delete all data
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "DELETE FROM sessions; DELETE FROM users;"

# Reset sequences
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "SELECT setval(pg_get_serial_sequence('users', 'id'), 1, false); SELECT setval(pg_get_serial_sequence('sessions', 'id'), 1, false);"

echo "✅ Database cleared!" 