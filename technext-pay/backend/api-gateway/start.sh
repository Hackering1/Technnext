#!/bin/sh
set -eu
case "${DATABASE_URL:-}" in
  postgresql://*) export SPRING_DATASOURCE_URL="jdbc:${DATABASE_URL}" ;;
  postgres://*) export SPRING_DATASOURCE_URL="jdbc:postgresql://${DATABASE_URL#postgres://}" ;;
  jdbc:*) export SPRING_DATASOURCE_URL="$DATABASE_URL" ;;
esac
exec java -XX:MaxRAMPercentage=75.0 -jar /app/app.jar

