#!/bin/sh
# Creates the least-privileged TaskFlow application role.
#
# PostgreSQL runs files in /docker-entrypoint-initdb.d/ only when PGDATA is
# empty (the first initialization of a new volume). On an existing volume this
# script does nothing; the manual role migration is documented in README.md.
#
# All work happens in a subshell so the file is safe both when it is executed
# (executable bit set) and when the official entrypoint sources it.

(
    set -eu

    : "${POSTGRES_USER:?POSTGRES_USER must be set}"
    : "${POSTGRES_DB:?POSTGRES_DB must be set}"
    : "${APP_DB_PASSWORD:?APP_DB_PASSWORD must be set}"

    psql \
        --set=ON_ERROR_STOP=1 \
        --username "$POSTGRES_USER" \
        --dbname "$POSTGRES_DB" \
        --set=db_name="$POSTGRES_DB" <<'SQL'
\getenv app_password APP_DB_PASSWORD

-- format(%I) quotes the role name as an identifier; format(%L) quotes the
-- password as a string literal. psql's :'app_password' substitution escapes
-- the value before it reaches format(), so the password is never concatenated
-- into SQL as raw text.
SELECT format(
    'CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L',
    'taskflow_app',
    :'app_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'taskflow_app')
\gexec

-- Enforce the desired attributes and password if the role already exists
-- (for example after a partially completed initialization). This script only
-- runs on an empty PGDATA and never rewrites roles in an existing cluster.
ALTER ROLE "taskflow_app"
    WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'app_password';

ALTER DATABASE :"db_name" OWNER TO "taskflow_app";
SQL
)

_taskflow_init_status=$?
if [ "$_taskflow_init_status" -ne 0 ]; then
    echo "ERROR: failed to initialize the TaskFlow application role (exit $_taskflow_init_status)" >&2
    # Fail the initialization. When the entrypoint sources this file, exit also
    # stops the entrypoint; when executed directly, it returns a non-zero status.
    exit "$_taskflow_init_status"
fi
