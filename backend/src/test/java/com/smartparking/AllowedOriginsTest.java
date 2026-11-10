package com.smartparking;

import static org.assertj.core.api.Assertions.assertThat;

import com.smartparking.config.AllowedOrigins;
import org.junit.jupiter.api.Test;

class AllowedOriginsTest {

  @Test
  void acceptsSpacedEnvironmentListWithoutEmptyOrDuplicateOrigins() {
    assertThat(
      AllowedOrigins.parse(
        " http://localhost:5173, https://parking.example.com , ,http://localhost:5173 "
      )
    ).containsExactly("http://localhost:5173", "https://parking.example.com");
  }
}
