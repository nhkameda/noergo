-- A thought's website: many thoughts are a client, a project or a channel that lives at an
-- address. Only absolute http(s) URLs, the same rule as the op schema, so nothing stored
-- here can become a javascript: link on someone's screen.
ALTER TABLE lanes
  ADD COLUMN url varchar(2048) CHECK (url IS NULL OR url ~ '^https?://');
