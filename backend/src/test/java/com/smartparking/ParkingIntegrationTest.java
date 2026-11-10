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
    "parking.access-simulation-enabled=true",
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
    db.update("UPDATE barrier_hardware SET position='UNKNOWN',phase='IDLE',request_id=NULL,last_seen_at=NULL");
    db.execute("TRUNCATE registered_plate");
    db.update("UPDATE camera_latest SET event_id=NULL,plate_text=NULL,plate=NULL,outcome=NULL,received_at=NULL WHERE id=1");
    for (String plate : List.of("43A12345", "43A99999", "43A12340", "43A12341", "43A12342", "43A12343"))
      db.update("INSERT INTO registered_plate(plate) VALUES(?)", plate);
    db.execute(
      "TRUNCATE vehicle_access_event, vehicle_visit, virtual_barrier RESTART IDENTITY"
    );
    db.update("INSERT INTO virtual_barrier(id) VALUES(1)");
    db.execute(
      "TRUNCATE parking_event, temperature_reading, fire_alarm_event RESTART IDENTITY"
    );
    db.update(
      "UPDATE temperature_sensor SET value_celsius=NULL,threshold_celsius=50,clear_threshold_celsius=45,blink_interval_ms=300,fire_opens_gate=true,alarm_active=false,status='UNKNOWN',last_reported_at=NULL,last_observed_at=NULL"
    );
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
  void temperaturePersistsAllReadingsButOnlyStateTransitions() {
    assertThat(service.snapshot().temperature().status()).isEqualTo(
      TemperatureData.Status.UNKNOWN
    );
    var normal = post(
      "temperature",
      Map.of("deviceId", "esp8266-01", "temperatureCelsius", 49),
      KEY
    );
    assertThat(normal.getStatusCode().value()).isEqualTo(200);
    assertThat(normal.getBody().temperature().status()).isEqualTo(
      TemperatureData.Status.NORMAL
    );
    var alarm = post(
      "temperature",
      Map.of("deviceId", "esp8266-01", "temperatureCelsius", 50),
      KEY
    );
    assertThat(alarm.getBody().temperature().status()).isEqualTo(
      TemperatureData.Status.ALARM
    );
    post(
      "temperature",
      Map.of("deviceId", "esp8266-01", "temperatureCelsius", 90),
      KEY
    );
    assertThat(
      db.queryForObject(
        "SELECT count(*) FROM temperature_reading",
        Integer.class
      )
    ).isEqualTo(3);
    assertThat(
      db.queryForObject("SELECT count(*) FROM fire_alarm_event", Integer.class)
    ).isEqualTo(2);
    var clear = post(
      "temperature",
      Map.of("deviceId", "esp8266-01", "temperatureCelsius", 45),
      KEY
    );
    assertThat(clear.getBody().temperature().status()).isEqualTo(
      TemperatureData.Status.NORMAL
    );
    assertThat(
      clear.getBody().temperature().events().get(0).previousStatus()
    ).isEqualTo(TemperatureData.Status.ALARM);
    assertThat(service.snapshot().stats().unknown()).isEqualTo(4);
    assertThat(service.history(100)).isEmpty();
  }

  @Test
  void firmwareHysteresisRetainsAlarmAndGateRequestAcrossTimeout() {
    for (int value : new int[] { 49, 50, 47 })
      post(
        "temperature",
        Map.of("deviceId", "esp8266-01", "temperatureCelsius", value),
        KEY
      );
    var active = service.snapshot().temperature();
    assertThat(active.status()).isEqualTo(TemperatureData.Status.ALARM);
    assertThat(active.alarmActive()).isTrue();
    assertThat(active.gateOpenRequested()).isTrue();
    assertThat(active.blinkIntervalMs()).isEqualTo(300);
    db.update(
      "UPDATE temperature_sensor SET last_reported_at=now()-interval '60 seconds'"
    );
    service.expire();
    var lost = service.snapshot().temperature();
    assertThat(lost.status()).isEqualTo(TemperatureData.Status.UNKNOWN);
    assertThat(lost.alarmActive()).isTrue();
    assertThat(lost.gateOpenRequested()).isTrue();
    assertThat(lost.events().get(0).gateOpenRequested()).isTrue();
    var held = post(
      "temperature",
      Map.of("deviceId", "esp8266-01", "temperatureCelsius", 47),
      KEY
    )
      .getBody()
      .temperature();
    assertThat(held.status()).isEqualTo(TemperatureData.Status.ALARM);
    var clear = post(
      "temperature",
      Map.of("deviceId", "esp8266-01", "temperatureCelsius", 45),
      KEY
    )
      .getBody()
      .temperature();
    assertThat(clear.status()).isEqualTo(TemperatureData.Status.NORMAL);
    assertThat(clear.alarmActive()).isFalse();
    assertThat(clear.gateOpenRequested()).isFalse();
    var cold = post(
      "temperature",
      Map.of("deviceId", "esp8266-01", "temperatureCelsius", 47),
      KEY
    )
      .getBody()
      .temperature();
    assertThat(cold.status()).isEqualTo(TemperatureData.Status.NORMAL);
  }

  @Test
  void temperatureRejectsUnauthorizedMalformedAndOutOfRangeReportsAtomically() {
    assertThat(
      post(
        "temperature",
        Map.of("deviceId", "esp8266-01", "temperatureCelsius", 85),
        null
      )
        .getStatusCode()
        .value()
    ).isEqualTo(401);
    for (Object bad : List.of(-41, 151, 80.001, "NaN")) {
      assertThat(
        post(
          "temperature",
          Map.of("deviceId", "esp8266-01", "temperatureCelsius", bad),
          KEY
        )
          .getStatusCode()
          .value()
      ).isEqualTo(400);
    }
    assertThat(
      post(
        "temperature",
        Map.of("deviceId", "other", "temperatureCelsius", 85),
        KEY
      )
        .getStatusCode()
        .value()
    ).isEqualTo(400);
    assertThat(
      post(
        "temperature",
        Map.of(
          "deviceId",
          "esp8266-01",
          "temperatureCelsius",
          85,
          "thresholdCelsius",
          100
        ),
        KEY
      )
        .getStatusCode()
        .value()
    ).isEqualTo(400);
    assertThat(
      db.queryForObject(
        "SELECT count(*) FROM temperature_reading",
        Integer.class
      )
    ).isZero();
    assertThat(
      db.queryForObject("SELECT count(*) FROM fire_alarm_event", Integer.class)
    ).isZero();
    assertThat(service.snapshot().revision()).isZero();
  }

  @Test
  void temperatureExpiresIndependentlyAndNeverClaimsLostAlarmWasCleared() {
    post("status", report(Status.OCCUPIED), KEY);
    post(
      "temperature",
      Map.of("deviceId", "esp8266-01", "temperatureCelsius", 90),
      KEY
    );
    db.update(
      "UPDATE temperature_sensor SET last_reported_at=now()-interval '60 seconds'"
    );
    post("heartbeat", new Heartbeat("esp8266-01"), KEY);
    service.expire();
    var expired = service.snapshot();
    assertThat(expired.device().online()).isTrue();
    assertThat(expired.stats().occupied()).isEqualTo(1);
    assertThat(expired.temperature().status()).isEqualTo(
      TemperatureData.Status.UNKNOWN
    );
    assertThat(expired.temperature().temperatureCelsius()).isNull();
    var event = expired.temperature().events().get(0);
    assertThat(event.previousStatus()).isEqualTo(TemperatureData.Status.ALARM);
    assertThat(event.status()).isEqualTo(TemperatureData.Status.UNKNOWN);
    assertThat(event.source()).isEqualTo("TIMEOUT");
    service.expire();
    assertThat(service.snapshot().temperature().events()).hasSize(2);
    post("heartbeat", new Heartbeat("esp8266-01"), KEY);
    assertThat(service.snapshot().temperature().status()).isEqualTo(
      TemperatureData.Status.UNKNOWN
    );
    assertThat(
      post(
        "temperature",
        Map.of("deviceId", "esp8266-01", "temperatureCelsius", 27),
        KEY
      )
        .getBody()
        .temperature()
        .status()
    ).isEqualTo(TemperatureData.Status.NORMAL);
  }

  @Test
  void temperatureObservedAtRejectsReplayWithoutSharingParkingTimestamp() {
    Instant at = Instant.now().minusSeconds(1);
    var temperature = new TemperatureData.Report(
      "esp8266-01",
      new java.math.BigDecimal("85"),
      at
    );
    assertThat(
      post("temperature", temperature, KEY).getStatusCode().value()
    ).isEqualTo(200);
    assertThat(
      post("temperature", temperature, KEY).getStatusCode().value()
    ).isEqualTo(409);
    var old = new TemperatureData.Report(
      "esp8266-01",
      new java.math.BigDecimal("85"),
      at.minusSeconds(60)
    );
    assertThat(post("temperature", old, KEY).getStatusCode().value()).isEqualTo(
      400
    );
    assertThat(
      post(
        "status",
        new Report(
          "esp8266-01",
          List.of(new Reading("P01", Status.OCCUPIED)),
          at
        ),
        KEY
      )
        .getStatusCode()
        .value()
    ).isEqualTo(200);
    assertThat(
      db.queryForObject(
        "SELECT count(*) FROM temperature_reading",
        Integer.class
      )
    ).isEqualTo(1);
  }

  @Test
  void concurrentTemperatureReportsPreserveReadingsWithoutDuplicatingActivation()
    throws Exception {
    try (var pool = new Pool(Executors.newFixedThreadPool(4))) {
      var tasks = new ArrayList<Future<?>>();
      for (int i = 0; i < 12; i++) tasks.add(
        pool.executor.submit(() -> {
          assertThat(
            post(
              "temperature",
              Map.of("deviceId", "esp8266-01", "temperatureCelsius", 85),
              KEY
            )
              .getStatusCode()
              .value()
          ).isEqualTo(200);
        })
      );
      for (var task : tasks) task.get(10, TimeUnit.SECONDS);
    }
    assertThat(
      db.queryForObject(
        "SELECT count(*) FROM temperature_reading",
        Integer.class
      )
    ).isEqualTo(12);
    assertThat(
      db.queryForObject("SELECT count(*) FROM fire_alarm_event", Integer.class)
    ).isEqualTo(1);
    assertThat(service.snapshot().revision()).isEqualTo(12);
    assertThat(
      http
        .getForEntity("/api/temperature/readings?limit=101", String.class)
        .getStatusCode()
        .value()
    ).isEqualTo(400);
    assertThat(
      http
        .getForEntity("/api/temperature/events?limit=0", String.class)
        .getStatusCode()
        .value()
    ).isEqualTo(400);
    assertThat(
      http
        .getForEntity("/api/temperature/status", String.class)
        .getStatusCode()
        .value()
    ).isEqualTo(200);
  }

  private ResponseEntity<AccessData.Result> accessPost(
    String path,
    Object body,
    boolean authenticated
  ) {
    var headers = new HttpHeaders();
    headers.setContentType(MediaType.APPLICATION_JSON);
    if (authenticated) headers.set("X-Device-Key", KEY);
    var response = http.postForEntity(
      path,
      new HttpEntity<>(body, headers),
      String.class
    );
    AccessData.Result result = null;
    if (response.getStatusCode().is2xxSuccessful()) try {
      result = mapper.readValue(response.getBody(), AccessData.Result.class);
    } catch (Exception error) {
      throw new AssertionError(error);
    }
    return new ResponseEntity<>(result, response.getStatusCode());
  }

  private AccessData.Detection detection(
    String plate,
    AccessData.Direction direction
  ) {
    return new AccessData.Detection(
      UUID.randomUUID(),
      plate,
      direction,
      new java.math.BigDecimal("0.95"),
      "entry-camera",
      null
    );
  }

  private AccessData.Result detect(AccessData.Detection detection) {
    var response = accessPost(
      "/api/device/vehicle-detections",
      detection,
      true
    );
    assertThat(response.getStatusCode().value()).isEqualTo(200);
    return response.getBody();
  }

  private AccessData.Result passage(long version) {
    var response = accessPost(
      "/api/access/simulation/barrier",
      new AccessData.Command(
        UUID.randomUUID(),
        AccessData.Action.PASSAGE,
        version
      ),
      false
    );
    assertThat(response.getStatusCode().value()).isEqualTo(200);
    return response.getBody();
  }

  private AccessData.HardwareReport feedback(AccessData.Barrier barrier, String phase, String gate) {
    return new AccessData.HardwareReport(barrier.requestId(), barrier.version(), barrier.pendingVisitId(), gate, phase, 100);
  }

  @Test
  void hardwareAutomaticallyCompletesEntryExitExactlyOnceAndRequiresKey() {
    var entry = detect(detection("43A-123.45", AccessData.Direction.ENTRY));
    var b = entry.snapshot().access().barrier();
    var done = feedback(b, "PASSED", "CLOSED");
    assertThat(accessPost("/api/device/barrier-feedback", done, false).getStatusCode().value()).isEqualTo(401);
    var opened = accessPost("/api/device/barrier-feedback", feedback(b, "OPEN", "OPEN"), true).getBody();
    assertThat(opened.snapshot().access().stats().pendingEntry()).isEqualTo(1);
    assertThat(opened.snapshot().access().barrier().actualPosition()).isEqualTo("OPEN");
    var completed = accessPost("/api/device/barrier-feedback", done, true).getBody();
    assertThat(completed.outcome()).isEqualTo("AUTO_PASSAGE_CONFIRMED");
    assertThat(completed.snapshot().access().stats().inside()).isEqualTo(1);
    assertThat(completed.snapshot().access().barrier().position()).isEqualTo("CLOSED");
    var duplicate = accessPost("/api/device/barrier-feedback", done, true).getBody();
    assertThat(duplicate.duplicate()).isTrue();
    assertThat(db.queryForObject("SELECT count(*) FROM vehicle_access_event WHERE source='DEVICE'", Integer.class)).isEqualTo(1);
    var exit = detect(detection("43A-123.45", AccessData.Direction.EXIT));
    // Old retained telemetry must not finish a new cycle.
    accessPost("/api/device/barrier-feedback", done, true);
    assertThat(service.snapshot().access().stats().pendingExit()).isEqualTo(1);
    var exited = accessPost("/api/device/barrier-feedback", feedback(exit.snapshot().access().barrier(), "PASSED", "CLOSED"), true).getBody();
    assertThat(exited.snapshot().access().stats().exited()).isEqualTo(1);
    assertThat(exited.snapshot().access().stats().inside()).isZero();
  }

  @Test
  void hardwareRejectsWrongCycleStaleSamplesAndNeverCountsBlockedOrTimeoutAsPassage() {
    var b = detect(detection("43A-123.45", AccessData.Direction.ENTRY)).snapshot().access().barrier();
    var wrong = new AccessData.HardwareReport(UUID.randomUUID(), b.version(), b.pendingVisitId(), "CLOSED", "PASSED", 100);
    assertThat(accessPost("/api/device/barrier-feedback", wrong, true).getBody().outcome()).isEqualTo("STALE_CYCLE");
    var stale = new AccessData.HardwareReport(b.requestId(), b.version(), b.pendingVisitId(), "CLOSED", "PASSED", 2001);
    assertThat(accessPost("/api/device/barrier-feedback", stale, true).getStatusCode().is4xxClientError()).isTrue();
    accessPost("/api/device/barrier-feedback", feedback(b, "BLOCKED", "OPEN"), true);
    assertThat(service.snapshot().access().stats().inside()).isZero();
    assertThat(service.snapshot().access().stats().pendingEntry()).isEqualTo(1);
    var cancelled = accessPost("/api/device/barrier-feedback", feedback(b, "CANCELLED", "CLOSED"), true).getBody();
    assertThat(cancelled.outcome()).isEqualTo("AUTO_CANCELLED_CLOSE");
    assertThat(cancelled.snapshot().access().visits().get(0).status()).isEqualTo("CANCELLED");
    assertThat(cancelled.snapshot().access().visits().get(0).entryAt()).isNull();
    db.update("UPDATE barrier_hardware SET last_seen_at=now()-interval '10 seconds'");
    assertThat(service.snapshot().access().barrier().hardwareConnected()).isFalse();
  }

  @Test
  void vehicleEntryAndExitRequirePassageBeforeTimestampsAreConfirmed() {
    var entry = detect(detection("43A-123.45", AccessData.Direction.ENTRY));
    assertThat(entry.outcome()).isEqualTo("ENTRY_PENDING");
    assertThat(entry.snapshot().access().barrier().position()).isEqualTo(
      "OPEN"
    );
    assertThat(entry.snapshot().access().visits().get(0).entryAt()).isNull();
    assertThat(entry.snapshot().device().online()).isFalse();
    var inside = passage(entry.snapshot().access().barrier().version());
    assertThat(inside.snapshot().access().visits().get(0).status()).isEqualTo(
      "INSIDE"
    );
    assertThat(
      inside.snapshot().access().visits().get(0).entryAt()
    ).isNotNull();
    var exit = detect(detection("43A12345", AccessData.Direction.EXIT));
    assertThat(exit.outcome()).isEqualTo("EXIT_PENDING");
    assertThat(exit.snapshot().access().stats().inside()).isEqualTo(1);
    assertThat(exit.snapshot().access().visits().get(0).exitAt()).isNull();
    var finished = passage(exit.snapshot().access().barrier().version());
    assertThat(finished.snapshot().access().visits().get(0).status()).isEqualTo(
      "EXITED"
    );
    assertThat(
      finished.snapshot().access().visits().get(0).exitAt()
    ).isNotNull();
    assertThat(finished.snapshot().access().barrier().position()).isEqualTo(
      "CLOSED"
    );
  }

  @Test
  void cameraRequiresKeyAndValidPlateConfidence() {
    assertThat(
      accessPost(
        "/api/device/vehicle-detections",
        detection("43A12345", AccessData.Direction.ENTRY),
        false
      )
        .getStatusCode()
        .value()
    ).isEqualTo(401);
    assertThat(
      accessPost(
        "/api/device/vehicle-detections",
        detection("garbage", AccessData.Direction.ENTRY),
        true
      )
        .getStatusCode()
        .value()
    ).isEqualTo(400);
    var low = new AccessData.Detection(
      UUID.randomUUID(),
      "43A12345",
      AccessData.Direction.ENTRY,
      new java.math.BigDecimal("0.74"),
      "camera",
      null
    );
    assertThat(
      accessPost("/api/device/vehicle-detections", low, true)
        .getStatusCode()
        .value()
    ).isEqualTo(400);
    assertThat(service.snapshot().access().visits()).isEmpty();
    assertThatThrownBy(() ->
      new AccessStore(db, false).requireSimulation()
    ).isInstanceOf(
      org.springframework.web.server.ResponseStatusException.class
    );
  }

  @Test
  void detectionIdempotencySurvivesPassageAndRejectsChangedPayload() {
    var packet = detection("43A12345", AccessData.Direction.ENTRY);
    var first = detect(packet);
    var duplicate = detect(packet);
    assertThat(duplicate.duplicate()).isTrue();
    assertThat(duplicate.snapshot().revision()).isEqualTo(
      first.snapshot().revision()
    );
    passage(first.snapshot().access().barrier().version());
    var replay = detect(packet);
    assertThat(replay.snapshot().access().barrier().position()).isEqualTo(
      "CLOSED"
    );
    assertThat(replay.snapshot().access().visits()).hasSize(1);
    var changed = new AccessData.Detection(
      packet.eventId(),
      "43A99999",
      packet.direction(),
      packet.confidence(),
      packet.cameraId(),
      null
    );
    assertThat(
      accessPost("/api/device/vehicle-detections", changed, true)
        .getStatusCode()
        .value()
    ).isEqualTo(409);
    assertThat(
      detect(detection("43A12345", AccessData.Direction.ENTRY)).outcome()
    ).isEqualTo("ALREADY_INSIDE");
  }

  @Test
  void virtualBarrierBusyCancelAndVersionGuardsPreserveVisitState() {
    var first = detect(detection("43A12345", AccessData.Direction.ENTRY));
    assertThat(
      detect(detection("43A99999", AccessData.Direction.ENTRY)).outcome()
    ).isEqualTo("BARRIER_BUSY");
    assertThat(
      accessPost(
        "/api/access/simulation/barrier",
        new AccessData.Command(UUID.randomUUID(), AccessData.Action.CLOSE, 0L),
        false
      )
        .getStatusCode()
        .value()
    ).isEqualTo(409);
    var close = accessPost(
      "/api/access/simulation/barrier",
      new AccessData.Command(
        UUID.randomUUID(),
        AccessData.Action.CLOSE,
        first.snapshot().access().barrier().version()
      ),
      false
    ).getBody();
    assertThat(close.snapshot().access().visits().get(0).status()).isEqualTo(
      "CANCELLED"
    );
    assertThat(close.snapshot().access().visits().get(0).entryAt()).isNull();
    assertThat(
      detect(detection("43A12345", AccessData.Direction.EXIT)).outcome()
    ).isEqualTo("NOT_INSIDE");
  }

  @Test
  void accessLedgerCapacityCountsPendingEntryWithoutInventingParkingSlot() {
    for (int i = 0; i < 4; i++) {
      var entry = detect(detection("43A1234" + i, AccessData.Direction.ENTRY));
      passage(entry.snapshot().access().barrier().version());
    }
    assertThat(
      detect(detection("43A99999", AccessData.Direction.ENTRY)).outcome()
    ).isEqualTo("CAPACITY_REACHED");
    assertThat(service.snapshot().access().stats().inside()).isEqualTo(4);
    assertThat(service.snapshot().stats().unknown()).isEqualTo(4);
  }

  @Test
  void fireOverrideHoldsVirtualBarrierOpenWithoutCreatingFalseVisits() {
    post(
      "temperature",
      Map.of("deviceId", "esp8266-01", "temperatureCelsius", 50),
      KEY
    );
    assertThat(service.snapshot().access().barrier().fireOverride()).isTrue();
    assertThat(service.snapshot().access().barrier().position()).isEqualTo(
      "OPEN"
    );
    assertThat(
      accessPost(
        "/api/access/simulation/barrier",
        new AccessData.Command(UUID.randomUUID(), AccessData.Action.CLOSE, 0L),
        false
      )
        .getStatusCode()
        .value()
    ).isEqualTo(409);
    assertThat(
      detect(detection("43A12345", AccessData.Direction.ENTRY)).outcome()
    ).isEqualTo("FIRE_OVERRIDE");
    assertThat(service.snapshot().access().visits()).isEmpty();
    post(
      "temperature",
      Map.of("deviceId", "esp8266-01", "temperatureCelsius", 45),
      KEY
    );
    assertThat(service.snapshot().access().barrier().position()).isEqualTo(
      "CLOSED"
    );
  }

  @Test
  void concurrentCameraRetriesCreateOneVisitAndOneEvent() throws Exception {
    var packet = detection("43A12345", AccessData.Direction.ENTRY);
    try (var pool = new Pool(Executors.newFixedThreadPool(4))) {
      var tasks = new ArrayList<Future<?>>();
      for (int i = 0; i < 10; i++) tasks.add(
        pool.executor.submit(() -> detect(packet))
      );
      for (var task : tasks) task.get(10, TimeUnit.SECONDS);
    }
    var state = service.snapshot().access();
    assertThat(state.visits()).hasSize(1);
    assertThat(state.events()).hasSize(1);
    assertThat(state.barrier().version()).isEqualTo(1);
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
      post(
        "temperature",
        Map.of("deviceId", "esp8266-01", "temperatureCelsius", 81),
        KEY
      );
      received = queue.poll(5, TimeUnit.SECONDS);
      assertThat(received).isNotNull();
      assertThat(received.temperature().status()).isEqualTo(
        TemperatureData.Status.ALARM
      );
      assertThat(received.temperature().events()).hasSize(1);
      session.send("/topic/parking", Map.of("revision", 999));
      error.get(5, TimeUnit.SECONDS);
      assertThat(service.snapshot().revision()).isEqualTo(received.revision());
    } finally {
      if (session.isConnected()) session.disconnect();
      client.stop();
      scheduler.shutdown();
    }
  }

  @Test
  void projectCameraChecksRegistrationWithoutInventingConfidence() {
    db.update("DELETE FROM registered_plate WHERE plate='43A12345'");
    var headers = new HttpHeaders();
    headers.setContentType(MediaType.APPLICATION_JSON);
    var denied = new CameraController.Reading(UUID.randomUUID(), "43A-123.45", AccessData.Direction.ENTRY, null);
    assertThat(http.postForEntity("/api/device/plate-readings", denied, String.class).getStatusCode().value()).isEqualTo(401);
    headers.set("X-Device-Key", KEY);
    var first = http.postForEntity("/api/device/plate-readings", new HttpEntity<>(denied, headers), CameraController.Latest.class);
    assertThat(first.getBody().outcome()).isEqualTo("NOT_REGISTERED");
    assertThat(service.snapshot().access().barrier().position()).isEqualTo("CLOSED");
    assertThat(service.snapshot().access().visits()).isEmpty();
    var registration = http.postForEntity("/api/device/registered-plates", new HttpEntity<>(new CameraController.Registration("43A-123.45", true), headers), String.class);
    assertThat(registration.getStatusCode().value()).isEqualTo(200);
    var allowed = new CameraController.Reading(UUID.randomUUID(), "43A-123.45", AccessData.Direction.ENTRY, null);
    var result = http.postForEntity("/api/device/plate-readings", new HttpEntity<>(allowed, headers), CameraController.Latest.class);
    assertThat(result.getBody().outcome()).isEqualTo("ENTRY_PENDING");
    assertThat(service.snapshot().access().barrier().position()).isEqualTo("OPEN");
    assertThat(service.snapshot().access().events().get(0).confidence()).isNull();
    assertThat(service.snapshot().access().visits().get(0).entryAt()).isNull();
    assertThat(http.postForEntity("/api/device/plate-readings", new HttpEntity<>(allowed, headers), CameraController.Latest.class).getStatusCode().value()).isEqualTo(200);
    assertThat(service.snapshot().access().visits()).hasSize(1);
    var invalid = new CameraController.Reading(UUID.randomUUID(), "OCR ?", AccessData.Direction.ENTRY, null);
    assertThat(http.postForEntity("/api/device/plate-readings", new HttpEntity<>(invalid, headers), CameraController.Latest.class).getBody().outcome()).isEqualTo("INVALID_PLATE");
    assertThat(service.snapshot().access().visits()).hasSize(1);
    var latest = http.getForObject("/api/camera/latest", CameraController.Latest.class);
    assertThat(latest.plateText()).isEqualTo("OCR ?");
    passage(service.snapshot().access().barrier().version());
    assertThat(service.snapshot().access().barrier().position()).isEqualTo("CLOSED");
    assertThat(service.snapshot().access().visits().get(0).entryAt()).isNotNull();
    // Revocation blocks subsequent camera detections too, including the older API.
    http.postForEntity("/api/device/registered-plates", new HttpEntity<>(new CameraController.Registration("43A12345", false), headers), String.class);
    assertThat(detect(detection("43A12345", AccessData.Direction.EXIT)).outcome()).isEqualTo("NOT_REGISTERED");
  }
}
