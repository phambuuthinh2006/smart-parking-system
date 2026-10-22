FROM maven:3.9.11-eclipse-temurin-17 AS build
WORKDIR /app
COPY pom.xml ./
COPY src ./src
RUN --mount=type=cache,target=/root/.m2 mvn -B package -DskipTests
FROM eclipse-temurin:17-jre-jammy
WORKDIR /app
RUN groupadd --system parking && useradd --system --gid parking parking
COPY --from=build /app/target/smart-parking-1.0.0.jar app.jar
USER parking
EXPOSE 18080
ENTRYPOINT ["java","-XX:MaxRAMPercentage=75","-jar","app.jar"]
