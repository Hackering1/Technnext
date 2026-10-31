#!/bin/sh
set -eu
case "${DATABASE_URL:-}" in
  postgresql://*) DB_URL="${DATABASE_URL#postgresql://}" ;;
  postgres://*) DB_URL="${DATABASE_URL#postgres://}" ;;
  jdbc:*) export SPRING_DATASOURCE_URL="$DATABASE_URL"; DB_URL="" ;;
  *) DB_URL="" ;;
esac
if [ -n "$DB_URL" ]; then
  # Keep credentials out of the JDBC URL so startup errors cannot print them.
  DB_HOST_AND_PATH="${DB_URL#*@}"
  export SPRING_DATASOURCE_URL="jdbc:postgresql://$DB_HOST_AND_PATH"
fi
if [ -n "${DATABASE_USER:-}" ]; then export SPRING_DATASOURCE_USERNAME="$DATABASE_USER"; fi
if [ -n "${DATABASE_PASSWORD:-}" ]; then export SPRING_DATASOURCE_PASSWORD="$DATABASE_PASSWORD"; fi
exec java -XX:MaxRAMPercentage=75.0 -jar /app/app.jar
