CREATE TABLE device (
  id varchar(40) PRIMARY KEY,
  online boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz,
  last_observed_at timestamptz,
  revision bigint NOT NULL DEFAULT 0
);
CREATE TABLE parking_space (
  id varchar(3) PRIMARY KEY CHECK (id IN ('P01','P02','P03','P04')),
  device_id varchar(40) NOT NULL REFERENCES device(id),
  status varchar(10) NOT NULL DEFAULT 'UNKNOWN' CHECK (status IN ('AVAILABLE','OCCUPIED','UNKNOWN')),
  last_reported_at timestamptz
);
CREATE TABLE parking_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  space_id varchar(3) NOT NULL REFERENCES parking_space(id),
  previous_status varchar(10) NOT NULL,
  status varchar(10) NOT NULL,
  created_at timestamptz NOT NULL,
  source varchar(20) NOT NULL CHECK (source IN ('DEVICE','TIMEOUT'))
);
CREATE INDEX parking_event_recent ON parking_event(id DESC);
INSERT INTO device(id) VALUES ('esp8266-01');
INSERT INTO parking_space(id,device_id) VALUES
 ('P01','esp8266-01'),('P02','esp8266-01'),('P03','esp8266-01'),('P04','esp8266-01');
