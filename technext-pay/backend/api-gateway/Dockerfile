FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /workspace
COPY backend/pom.xml backend/pom.xml
COPY backend/api-gateway/pom.xml backend/api-gateway/pom.xml
COPY backend/api-gateway/src backend/api-gateway/src
RUN mvn -f backend/pom.xml -pl api-gateway -am package -DskipTests
FROM eclipse-temurin:17-jre-alpine
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /workspace/backend/api-gateway/target/api-gateway-0.1.0.jar app.jar
COPY backend/api-gateway/start.sh /app/start.sh
RUN chmod +x /app/start.sh
USER app
EXPOSE 8080
ENTRYPOINT ["/app/start.sh"]

