"""Create the PortPulse database schema after the infrastructure is deployed."""

import json

from shared.db import INIT_SCHEMA_SQL, get_db


def handler(event, context):
    """Run each idempotent schema statement through the RDS Data API."""
    db = get_db()
    executed = 0

    for sql in INIT_SCHEMA_SQL.split(";"):
        statement = sql.strip()
        if not statement:
            continue
        db.execute(statement)
        executed += 1

    return {
        "statusCode": 200,
        "body": json.dumps({"executed_statements": executed}),
    }
