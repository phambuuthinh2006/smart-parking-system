package com.smartparking;

import jakarta.validation.ConstraintViolationException;
import java.util.Map;
import org.springframework.http.*;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestControllerAdvice
public class ApiErrors {

  @ExceptionHandler({
    MethodArgumentNotValidException.class,
    ConstraintViolationException.class,
    HttpMessageNotReadableException.class,
  })
  public ResponseEntity<?> validation(Exception error) {
    return ResponseEntity.badRequest().body(
      Map.of("message", "Invalid device, space, status or request fields")
    );
  }

  @ExceptionHandler(ResponseStatusException.class)
  public ResponseEntity<?> status(ResponseStatusException error) {
    return ResponseEntity.status(error.getStatusCode()).body(
      Map.of(
        "message",
        error.getReason() == null ? "Request rejected" : error.getReason()
      )
    );
  }
}
