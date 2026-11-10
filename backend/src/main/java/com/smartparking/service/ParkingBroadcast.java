package com.smartparking.service;

import com.smartparking.model.ParkingData;

import org.slf4j.*;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.*;

@Component
public class ParkingBroadcast {

  private static final Logger log = LoggerFactory.getLogger(
    ParkingBroadcast.class
  );
  private final SimpMessagingTemplate messaging;

  public ParkingBroadcast(SimpMessagingTemplate messaging) {
    this.messaging = messaging;
  }

  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void changed(ParkingData.Changed event) {
    try {
      messaging.convertAndSend("/topic/parking", event.snapshot());
    } catch (RuntimeException error) {
      log.warn(
        "State saved; realtime broadcast failed. Clients can recover via HTTP polling."
      );
    }
  }
}
