#!/bin/sh
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<EOSQL
CREATE ROLE sandbox_runner LOGIN PASSWORD '${SANDBOX_RUNNER_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 16;
REVOKE ALL ON DATABASE ${POSTGRES_DB} FROM PUBLIC;
GRANT CONNECT, CREATE ON DATABASE ${POSTGRES_DB} TO sandbox_runner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON pg_catalog.pg_stat_activity FROM PUBLIC;
ALTER ROLE sandbox_runner SET statement_timeout = '2500ms';
ALTER ROLE sandbox_runner SET lock_timeout = '1000ms';
ALTER ROLE sandbox_runner SET idle_in_transaction_session_timeout = '8000ms';
ALTER ROLE sandbox_runner SET temp_file_limit = '32MB';
ALTER ROLE sandbox_runner SET work_mem = '4MB';
ALTER ROLE sandbox_runner SET search_path = pg_catalog;
EOSQL
