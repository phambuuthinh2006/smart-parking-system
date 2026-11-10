ALTER TABLE vehicle_access_event DROP CONSTRAINT vehicle_access_event_source_check;
ALTER TABLE vehicle_access_event ADD CONSTRAINT vehicle_access_event_source_check
  CHECK (source IN ('CAMERA','SIMULATION','DEVICE'));
CREATE TABLE barrier_hardware (
  id integer PRIMARY KEY CHECK (id=1),
  position varchar(7) NOT NULL DEFAULT 'UNKNOWN',
  phase varchar(12) NOT NULL DEFAULT 'IDLE',
  request_id uuid,
  last_seen_at timestamptz
);
INSERT INTO barrier_hardware(id) VALUES(1);
