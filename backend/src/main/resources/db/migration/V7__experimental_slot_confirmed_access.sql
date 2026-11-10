ALTER TABLE vehicle_visit DROP CONSTRAINT vehicle_visit_status_check;
ALTER TABLE vehicle_visit ADD CONSTRAINT vehicle_visit_status_check CHECK
 (status IN ('PENDING_ENTRY','PENDING_PARKING','INSIDE','PENDING_EXIT','EXITED','CANCELLED'));
DROP INDEX vehicle_visit_one_active_plate;
CREATE UNIQUE INDEX vehicle_visit_one_active_plate ON vehicle_visit(plate)
 WHERE status IN ('PENDING_ENTRY','PENDING_PARKING','INSIDE','PENDING_EXIT');
ALTER TABLE vehicle_visit ADD COLUMN gate_entered_at timestamptz;
ALTER TABLE vehicle_visit ADD COLUMN slot_left_at timestamptz;
ALTER TABLE vehicle_access_event DROP CONSTRAINT vehicle_access_event_kind_check;
ALTER TABLE vehicle_access_event ADD CONSTRAINT vehicle_access_event_kind_check
 CHECK (kind IN ('DETECTION','PASSAGE','OPEN','CLOSE','SLOT'));
ALTER TABLE barrier_hardware ADD COLUMN gate_present boolean NOT NULL DEFAULT false;
ALTER TABLE barrier_hardware ADD COLUMN gate_sensor_valid boolean NOT NULL DEFAULT false;
CREATE TABLE camera_encounter (
 encounter_id uuid PRIMARY KEY,
 plate varchar(12) NOT NULL,
 visit_id bigint NOT NULL REFERENCES vehicle_visit(id),
 created_at timestamptz NOT NULL
);
ALTER TABLE vehicle_access_event ADD COLUMN requested_direction varchar(5);
ALTER TABLE vehicle_access_event ADD COLUMN encounter_id uuid;
