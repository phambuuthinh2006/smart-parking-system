CREATE TABLE temperature_sensor (
  device_id varchar(40) PRIMARY KEY REFERENCES device(id),
  value_celsius numeric(5,2) CHECK (value_celsius BETWEEN -40 AND 150),
  threshold_celsius numeric(5,2) NOT NULL DEFAULT 80 CHECK (threshold_celsius BETWEEN -40 AND 150),
  status varchar(10) NOT NULL DEFAULT 'UNKNOWN' CHECK (status IN ('NORMAL','ALARM','UNKNOWN')),
  last_reported_at timestamptz,
  last_observed_at timestamptz
);
CREATE TABLE temperature_reading (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id varchar(40) NOT NULL REFERENCES temperature_sensor(device_id),
  value_celsius numeric(5,2) NOT NULL CHECK (value_celsius BETWEEN -40 AND 150),
  threshold_celsius numeric(5,2) NOT NULL,
  status varchar(10) NOT NULL CHECK (status IN ('NORMAL','ALARM')),
  recorded_at timestamptz NOT NULL,
  observed_at timestamptz
);
CREATE TABLE fire_alarm_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id varchar(40) NOT NULL REFERENCES temperature_sensor(device_id),
  previous_status varchar(10) NOT NULL CHECK (previous_status IN ('NORMAL','ALARM','UNKNOWN')),
  status varchar(10) NOT NULL CHECK (status IN ('NORMAL','ALARM','UNKNOWN')),
  value_celsius numeric(5,2),
  threshold_celsius numeric(5,2) NOT NULL,
  created_at timestamptz NOT NULL,
  source varchar(20) NOT NULL CHECK (source IN ('DEVICE','TIMEOUT'))
);
INSERT INTO temperature_sensor(device_id) VALUES ('esp8266-01');
