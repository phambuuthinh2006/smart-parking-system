ALTER TABLE temperature_sensor
  ADD COLUMN clear_threshold_celsius numeric(5,2) NOT NULL DEFAULT 45,
  ADD COLUMN blink_interval_ms integer NOT NULL DEFAULT 300,
  ADD COLUMN fire_opens_gate boolean NOT NULL DEFAULT true,
  ADD COLUMN alarm_active boolean NOT NULL DEFAULT false;
-- Existing readings belong to the previous policy. Await a fresh measurement for
-- the new policy, but retain any active alarm until a confirmed cool reading.
UPDATE temperature_sensor
SET alarm_active=(status='ALARM'),status='UNKNOWN',threshold_celsius=50;
ALTER TABLE temperature_sensor ALTER COLUMN threshold_celsius SET DEFAULT 50;
ALTER TABLE temperature_sensor
  ADD CONSTRAINT temperature_hysteresis CHECK (clear_threshold_celsius >= -40 AND clear_threshold_celsius < threshold_celsius),
  ADD CONSTRAINT temperature_blink_interval CHECK (blink_interval_ms BETWEEN 300 AND 10000);
ALTER TABLE temperature_reading
  ADD COLUMN clear_threshold_celsius numeric(5,2),
  ADD COLUMN gate_open_requested boolean;
ALTER TABLE fire_alarm_event
  ADD COLUMN clear_threshold_celsius numeric(5,2),
  ADD COLUMN gate_open_requested boolean;
-- Preserve the old single-threshold policy in historical records. Gate previews
-- did not exist then, so NULL means not recorded rather than a fabricated command.
UPDATE temperature_reading SET clear_threshold_celsius=threshold_celsius;
UPDATE fire_alarm_event SET clear_threshold_celsius=threshold_celsius;
ALTER TABLE temperature_reading ALTER COLUMN clear_threshold_celsius SET NOT NULL;
ALTER TABLE fire_alarm_event ALTER COLUMN clear_threshold_celsius SET NOT NULL;
