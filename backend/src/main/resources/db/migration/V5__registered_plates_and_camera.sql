CREATE TABLE registered_plate (
  plate varchar(12) PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  registered_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE camera_latest (
  id integer PRIMARY KEY CHECK (id=1),
  event_id uuid,
  plate_text varchar(100),
  plate varchar(12),
  outcome varchar(24),
  received_at timestamptz
);
INSERT INTO camera_latest(id) VALUES(1);
