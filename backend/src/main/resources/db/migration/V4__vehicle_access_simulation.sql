CREATE TABLE vehicle_visit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plate varchar(12) NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('PENDING_ENTRY','INSIDE','PENDING_EXIT','EXITED','CANCELLED')),
  source varchar(12) NOT NULL CHECK (source IN ('CAMERA','SIMULATION')),
  created_at timestamptz NOT NULL,
  entry_at timestamptz,
  exit_at timestamptz
);
CREATE UNIQUE INDEX vehicle_visit_one_active_plate ON vehicle_visit(plate)
  WHERE status IN ('PENDING_ENTRY','INSIDE','PENDING_EXIT');
CREATE TABLE virtual_barrier (
  id integer PRIMARY KEY CHECK (id=1),
  position varchar(6) NOT NULL DEFAULT 'CLOSED' CHECK (position IN ('OPEN','CLOSED')),
  version bigint NOT NULL DEFAULT 0,
  pending_visit_id bigint REFERENCES vehicle_visit(id),
  direction varchar(5) CHECK (direction IN ('ENTRY','EXIT')),
  reason varchar(10) NOT NULL DEFAULT 'IDLE',
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO virtual_barrier(id) VALUES(1);
CREATE TABLE vehicle_access_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE,
  kind varchar(12) NOT NULL CHECK (kind IN ('DETECTION','PASSAGE','OPEN','CLOSE')),
  plate varchar(12),
  direction varchar(5),
  confidence numeric(5,4),
  camera_id varchar(40),
  observed_at timestamptz,
  source varchar(12) NOT NULL CHECK (source IN ('CAMERA','SIMULATION')),
  outcome varchar(24) NOT NULL,
  visit_id bigint REFERENCES vehicle_visit(id),
  expected_version bigint,
  created_at timestamptz NOT NULL
);
