package com.smartparking.config;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class DeviceKeyFilter extends OncePerRequestFilter {

  private final byte[] expected;

  public DeviceKeyFilter(@Value("${parking.device-key}") String key) {
    if (key.isBlank() || key.length() < 24) throw new IllegalArgumentException(
      "DEVICE_API_KEY must contain at least 24 characters"
    );
    expected = key.getBytes(StandardCharsets.UTF_8);
  }

  @Override
  protected boolean shouldNotFilter(HttpServletRequest request) {
    return (
      !request.getServletPath().startsWith("/api/device/") ||
      request.getMethod().equals("OPTIONS")
    );
  }

  @Override
  protected void doFilterInternal(
    HttpServletRequest request,
    HttpServletResponse response,
    FilterChain chain
  ) throws ServletException, IOException {
    String supplied = request.getHeader("X-Device-Key");
    if (
      supplied == null ||
      !MessageDigest.isEqual(
        expected,
        supplied.getBytes(StandardCharsets.UTF_8)
      )
    ) {
      response.setStatus(401);
      response.setContentType("application/json");
      response.getWriter().write("{\"message\":\"Invalid device key\"}");
      return;
    }
    chain.doFilter(request, response);
  }
}
