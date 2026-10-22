package com.smartparking;

import java.util.Arrays;

final class AllowedOrigins {

  private AllowedOrigins() {}

  static String[] parse(String value) {
    return Arrays.stream(value.split(","))
      .map(String::trim)
      .filter(origin -> !origin.isEmpty())
      .distinct()
      .toArray(String[]::new);
  }
}
