# Infrastructure

The initial local stack is defined in the repository-root `docker-compose.yml`: PostgreSQL, Redis, single-node Kafka, the Spring Boot API and the React/Nginx merchant portal. This compose topology is for local development and sandbox testing only; it has no production TLS, managed secrets, multi-node availability, backups, or payment-provider certification.

