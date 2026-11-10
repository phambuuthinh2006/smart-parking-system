package com.smartparking.config;

import java.util.Arrays;

public final class AllowedOrigins {

  private AllowedOrigins() {}

  public static String[] parse(String value) {
    return Arrays.stream(value.split(","))
      .map(String::trim)
      .filter(origin -> !origin.isEmpty())
      .distinct()
      .toArray(String[]::new);
  }
}
