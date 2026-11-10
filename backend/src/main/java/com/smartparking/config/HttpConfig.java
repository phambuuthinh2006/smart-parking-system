package com.smartparking.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.*;

@Configuration
public class HttpConfig implements WebMvcConfigurer {

  private final String[] origins;

  public HttpConfig(@Value("${parking.allowed-origins}") String origins) {
    this.origins = AllowedOrigins.parse(origins);
  }

  @Override
  public void addCorsMappings(CorsRegistry registry) {
    registry
      .addMapping("/api/**")
      .allowedOrigins(origins)
      .allowedMethods("GET", "POST", "DELETE", "OPTIONS")
      .allowedHeaders("Content-Type", "X-Device-Key")
      .maxAge(3600);
  }
}
