package com.smartparking;

import static com.smartparking.ParkingData.*;
import static org.assertj.core.api.Assertions.*;

import java.lang.reflect.Type;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.messaging.converter.MappingJackson2MessageConverter;
import org.springframework.messaging.simp.stomp.*;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.test.context.*;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;

@SpringBootTest(
  webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
  properties = {
    "parking.device-key=test-only-device-key-1234567890",
    "parking.expiry-check-ms=3600000",
    "parking.stale-after-seconds=45",
  }
)
@EnabledIfEnvironmentVariable(named = "TEST_DATABASE_URL", matches = ".+")
class ParkingIntegrationTest {

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry properties) {
    String url = System.getenv("TEST_DATABASE_URL");
    if (
      !url.matches("jdbc:postgresql://[^/]+/parking_test")
    ) throw new IllegalArgumentException(
      "Tests require the isolated parking_test database"
    );
    properties.add("spring.datasource.url", () -> url);
  }

  @Autowired
  TestRestTemplate http;

  @Autowired
  com.fasterxml.jackson.databind.ObjectMapper mapper;

  @Autowired
  JdbcTemplate db;

  @Autowired
  ParkingService service;

  @LocalServerPort
  int port;

  static final String KEY = "test-only-device-key-1234567890";

  @BeforeEach
  void reset() {
    db.execute("TRUNCATE parking_event RESTART IDENTITY");
    db.update(
      "UPDATE parking_space SET status='UNKNOWN',last_reported_at=NULL"
    );
    db.update(
      "UPDATE device SET online=false,last_seen_at=NULL,last_observed_at=NULL,revision=0"
    );
  }

  ResponseEntity<Snapshot> post(String endpoint, Object body, String key) {
    var headers = new HttpHeaders();
    headers.setContentType(MediaType.APPLICATION_JSON);
    if (key != null) headers.set("X-Device-Key", key);
    var response = http.postForEntity(
      "/api/device/" + endpoint,
      new HttpEntity<>(body, headers),
      String.class
    );
    Snapshot snapshot = null;
    if (response.getStatusCode().is2xxSuccessful()) {
      try {
        snapshot = mapper.readValue(response.getBody(), Snapshot.class);
      } catch (Exception error) {
        throw new AssertionError(error);
      }
    }
    return new ResponseEntity<>(snapshot, response.getStatusCode());
  }

  Report report(Status status) {
    return new Report("esp8266-01", List.of(new Reading("P01", status)), null);
  }

  @Test
  void startsUnknownAndRequiresDeviceKey() {
    assertThat(service.snapshot().stats().unknown()).isEqualTo(4);
    assertThat(
      post("status", report(Status.OCCUPIED), null).getStatusCode().value()
    ).isEqualTo(401);
    assertThat(
      post("status", report(Status.OCCUPIED), "bad").getStatusCode().value()
    ).isEqualTo(401);
    assertThat(service.history(100)).isEmpty();
  }

  @Test
  void changesPersistButDuplicatesOnlyRefreshLiveness() {
    var response = post("status", report(Status.OCCUPIED), KEY);
    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(response.getBody().stats().occupied()).isEqualTo(1);
    assertThat(response.getBody().device().online()).isTrue();
    post("status", report(Status.OCCUPIED), KEY);
    assertThat(service.history(100)).hasSize(1);
    assertThat(service.snapshot().revision()).isEqualTo(2);
    post("status", report(Status.AVAILABLE), KEY);
    assertThat(service.history(100))
      .extracting(Event::status)
      .containsExactly(Status.AVAILABLE, Status.OCCUPIED);
  }

  @Test
  void malformedBatchRollsBackAllReadings() {
    var invalid = Map.of(
      "deviceId",
      "esp8266-01",
      "spaces",
      List.of(
        Map.of("spaceId", "P01", "status", "OCCUPIED"),
        Map.of("spaceId", "P99", "status", "AVAILABLE")
      )
    );
    assertThat(post("status", invalid, KEY).getStatusCode().value()).isEqualTo(
      400
    );
    var duplicate = new Report(
      "esp8266-01",
      List.of(
        new Reading("P01", Status.OCCUPIED),
        new Reading("P01", Status.AVAILABLE)
      ),
      null
    );
    assertThat(
      post("status", duplicate, KEY).getStatusCode().value()
    ).isEqualTo(400);
    assertThat(
      post("status", Map.of("deviceId", "esp8266-01", "spaces", List.of()), KEY)
        .getStatusCode()
        .value()
    ).isEqualTo(400);
    assertThat(service.snapshot().revision()).isZero();
    assertThat(service.history(100)).isEmpty();
  }

  @Test
  void timestampedReportsRejectReplayAndStaleInput() {
    var now = Instant.now().minusSeconds(1);
    var report = new Report(
      "esp8266-01",
      List.of(new Reading("P01", Status.OCCUPIED)),
      now
    );
    assertThat(post("status", report, KEY).getStatusCode().value()).isEqualTo(
      200
    );
    assertThat(post("status", report, KEY).getStatusCode().value()).isEqualTo(
      409
    );
    assertThat(
      post(
        "status",
        new Report("esp8266-01", report.spaces(), now.minusSeconds(100)),
        KEY
      )
        .getStatusCode()
        .value()
    ).isEqualTo(400);
    assertThat(service.history(100)).hasSize(1);
  }

  @Test
  void expiryAndHeartbeatDoNotFabricateRecoveredSensorData() {
    post("status", report(Status.OCCUPIED), KEY);
    db.update(
      "UPDATE parking_space SET last_reported_at=now()-interval '60 seconds'"
    );
    db.update("UPDATE device SET last_seen_at=now()-interval '60 seconds'");
    service.expire();
    var expired = service.snapshot();
    assertThat(expired.device().online()).isFalse();
    assertThat(expired.stats().unknown()).isEqualTo(4);
    assertThat(service.history(100).get(0).source()).isEqualTo("TIMEOUT");
    service.expire();
    assertThat(service.history(100)).hasSize(2);
    post("heartbeat", new Heartbeat("esp8266-01"), KEY);
    assertThat(service.snapshot().device().online()).isTrue();
    assertThat(service.snapshot().stats().unknown()).isEqualTo(4);
  }

  @Test
  void heartbeatKeepsDeviceAliveButNotStaleSensor() {
    post("status", report(Status.OCCUPIED), KEY);
    db.update(
      "UPDATE parking_space SET last_reported_at=now()-interval '60 seconds'"
    );
    post("heartbeat", new Heartbeat("esp8266-01"), KEY);
    service.expire();
    assertThat(service.snapshot().device().online()).isTrue();
    assertThat(service.snapshot().stats().unknown()).isEqualTo(4);
  }

  @Test
  void concurrentReportsSerializeWithoutLostHistory() throws Exception {
    try (var pool = new Pool(Executors.newFixedThreadPool(4))) {
      var tasks = new ArrayList<Future<?>>();
      for (int i = 0; i < 12; i++) tasks.add(
        pool.executor.submit(() -> post("status", report(Status.OCCUPIED), KEY))
      );
      for (var task : tasks) task.get(10, TimeUnit.SECONDS);
    }
    assertThat(service.snapshot().revision()).isEqualTo(12);
    assertThat(service.history(100)).hasSize(1);
  }

  record Pool(ExecutorService executor) implements AutoCloseable {
    public void close() {
      executor.shutdownNow();
    }
  }

  @Test
  void malformedJsonReturnsConsistentBadRequest() {
    var headers = new HttpHeaders();
    headers.setContentType(MediaType.APPLICATION_JSON);
    headers.set("X-Device-Key", KEY);
    var response = http.postForEntity(
      "/api/device/status",
      new HttpEntity<>("{broken-json", headers),
      String.class
    );
    assertThat(response.getStatusCode().value()).isEqualTo(400);
    assertThat(response.getBody())
      .contains("message")
      .doesNotContain("stackTrace");
    assertThat(service.snapshot().revision()).isZero();
  }

  @Test
  void historyLimitIsValidated() {
    assertThat(
      http
        .getForEntity("/api/parking/history?limit=101", String.class)
        .getStatusCode()
        .value()
    ).isEqualTo(400);
    assertThat(
      http
        .getForEntity("/api/parking/history?limit=0", String.class)
        .getStatusCode()
        .value()
    ).isEqualTo(400);
  }

  @Test
  void websocketReceivesCommittedSnapshotAndRejectsClientPublishing()
    throws Exception {
    var client = new WebSocketStompClient(new StandardWebSocketClient());
    var converter = new MappingJackson2MessageConverter();
    converter.setObjectMapper(
      new com.fasterxml.jackson.databind.ObjectMapper().findAndRegisterModules()
    );
    client.setMessageConverter(converter);
    var scheduler = new ThreadPoolTaskScheduler();
    scheduler.initialize();
    client.setTaskScheduler(scheduler);
    var queue = new LinkedBlockingQueue<Snapshot>();
    var error = new CompletableFuture<String>();
    var session = client
      .connectAsync(
        "ws://localhost:" + port + "/ws",
        new StompSessionHandlerAdapter() {
          @Override
          public Type getPayloadType(StompHeaders headers) {
            return byte[].class;
          }

          @Override
          public void handleFrame(StompHeaders headers, Object payload) {
            error.complete(String.valueOf(payload));
          }

          @Override
          public void handleTransportError(
            StompSession session,
            Throwable exception
          ) {
            error.complete("closed");
          }
        }
      )
      .get(5, TimeUnit.SECONDS);
    try {
      session.subscribe(
        "/topic/parking",
        new StompFrameHandler() {
          public Type getPayloadType(StompHeaders headers) {
            return Snapshot.class;
          }

          public void handleFrame(StompHeaders headers, Object payload) {
            queue.add((Snapshot) payload);
          }
        }
      );
      // Spring's simple broker has no RECEIPT support. Wait for an actual committed heartbeat.
      org.awaitility.Awaitility.await()
        .atMost(5, TimeUnit.SECONDS)
        .untilAsserted(() -> {
          post("heartbeat", new Heartbeat("esp8266-01"), KEY);
          assertThat(queue.poll(500, TimeUnit.MILLISECONDS)).isNotNull();
        });
      queue.clear();
      post("status", report(Status.OCCUPIED), KEY);
      var received = queue.poll(5, TimeUnit.SECONDS);
      assertThat(received).isNotNull();
      assertThat(received.revision()).isEqualTo(service.snapshot().revision());
      assertThat(received.events()).hasSize(1);
      session.send("/topic/parking", Map.of("revision", 999));
      error.get(5, TimeUnit.SECONDS);
      assertThat(service.snapshot().revision()).isEqualTo(received.revision());
    } finally {
      if (session.isConnected()) session.disconnect();
      client.stop();
      scheduler.shutdown();
    }
  }
}
