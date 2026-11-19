-- Runs once when the Docker volume is first created.
CREATE DATABASE specbase_test OWNER specbase;
\c specbase
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
\c specbase_test
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
