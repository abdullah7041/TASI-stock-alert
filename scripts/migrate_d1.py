#!/usr/bin/env python3
"""Export the eight legacy cockpit tables and build an idempotent D1 import."""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


TABLES = (
    "agent_messages",
    "agent_reports",
    "agent_usage",
    "artifact_deliveries",
    "dashboard_snapshots",
    "movement_alerts",
    "portfolio_events",
    "top10_proposals",
)
LARGE_CELL = 6_000


def quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def quote_value(value: object) -> str:
    if value is None:
        return "NULL"
    if value is True:
        return "1"
    if value is False:
        return "0"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("D1 cannot import non-finite numeric values")
        return repr(value)
    if isinstance(value, str):
        return "'" + value.replace("'", "''") + "'"
    raise TypeError(f"Unsupported D1 value type: {type(value).__name__}")


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"{name} is required")
    return value


def fetch_page(origin: str, table: str, offset: int) -> dict:
    bypass = require_env("LEGACY_BYPASS_TOKEN")
    export_token = require_env("MIGRATION_EXPORT_TOKEN")
    url = origin.rstrip("/") + "/api/migration/export?" + urllib.parse.urlencode({"table": table, "offset": offset})
    request = urllib.request.Request(url, headers={
        "OAI-Sites-Authorization": f"Bearer {bypass}",
        "Authorization": f"Bearer {export_token}",
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise SystemExit(f"Legacy export failed for {table} at offset {offset}: HTTP {error.code}") from error
    except urllib.error.URLError as error:
        raise SystemExit(f"Legacy export failed for {table} at offset {offset}: {error.reason}") from error


def export_legacy(args: argparse.Namespace) -> None:
    exported: dict[str, dict] = {}
    for table in TABLES:
        offset = 0
        rows: list[dict] = []
        schema: list[dict] | None = None
        columns: list[dict] | None = None
        while True:
            page = fetch_page(args.origin, table, offset)
            if page.get("table") != table:
                raise SystemExit(f"Legacy export returned a mismatched table for {table}")
            if schema is None:
                schema = page.get("schema")
                columns = page.get("columns")
            rows.extend(page.get("rows") or [])
            next_offset = page.get("nextOffset")
            if next_offset is None:
                break
            if not isinstance(next_offset, int) or next_offset <= offset:
                raise SystemExit(f"Legacy export returned an invalid page offset for {table}")
            offset = next_offset
        if not schema or not columns:
            raise SystemExit(f"Legacy export did not include schema and columns for {table}")
        exported[table] = {"schema": schema, "columns": columns, "rows": rows}
        print(f"{table}: {len(rows)} rows")
    payload = {"exportedAt": datetime.now(timezone.utc).isoformat(), "origin": args.origin, "tables": exported}
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.with_suffix(output.suffix + ".tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    temp.replace(output)


def create_statement(statement: str) -> str:
    statement = statement.strip().rstrip(";")
    if statement.upper().startswith("CREATE TABLE "):
        return "CREATE TABLE IF NOT EXISTS " + statement[len("CREATE TABLE "):]
    if statement.upper().startswith("CREATE UNIQUE INDEX "):
        return "CREATE UNIQUE INDEX IF NOT EXISTS " + statement[len("CREATE UNIQUE INDEX "):]
    if statement.upper().startswith("CREATE INDEX "):
        return "CREATE INDEX IF NOT EXISTS " + statement[len("CREATE INDEX "):]
    return statement


def primary_key(columns: list[dict]) -> list[str]:
    return [column["name"] for column in sorted(columns, key=lambda column: column.get("pk") or 0) if column.get("pk")]


def where_clause(row: dict, columns: list[dict]) -> str:
    names = primary_key(columns) or [column["name"] for column in columns]
    return " AND ".join(f"{quote_identifier(name)} IS {quote_value(row.get(name))}" for name in names)


def migration_sql(args: argparse.Namespace) -> None:
    payload = json.loads(Path(args.input).read_text(encoding="utf-8"))
    tables = payload.get("tables")
    if not isinstance(tables, dict) or set(tables) != set(TABLES):
        raise SystemExit("Export file does not contain exactly the trusted tables")
    statements = ["PRAGMA foreign_keys = OFF;"]
    index_statements: list[str] = []
    for table in TABLES:
        for entry in tables[table]["schema"]:
            sql = entry.get("sql")
            if not sql:
                continue
            statement = create_statement(sql)
            if entry.get("type") == "index":
                index_statements.append(statement + ";")
            else:
                statements.append(statement + ";")
    for table in TABLES:
        source = tables[table]
        columns = source["columns"]
        names = [column["name"] for column in columns]
        if not names:
            raise SystemExit(f"No columns supplied for {table}")
        quoted_names = ", ".join(quote_identifier(name) for name in names)
        for row in source["rows"]:
            if not isinstance(row, dict):
                raise SystemExit(f"Invalid row in {table}")
            large_values = {name: row.get(name) for name in names if isinstance(row.get(name), str) and len(row[name]) > LARGE_CELL}
            values = [quote_value("" if name in large_values else row.get(name)) for name in names]
            statements.append(f"INSERT OR REPLACE INTO {quote_identifier(table)} ({quoted_names}) VALUES ({', '.join(values)});")
            if large_values:
                selector = where_clause(row, columns)
                for name, value in large_values.items():
                    for start in range(0, len(value), LARGE_CELL):
                        chunk = quote_value(value[start:start + LARGE_CELL])
                        statements.append(f"UPDATE {quote_identifier(table)} SET {quote_identifier(name)} = COALESCE({quote_identifier(name)}, '') || {chunk} WHERE {selector};")
    statements.extend(index_statements)
    statements.append("PRAGMA foreign_keys = ON;")
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(statements) + "\n", encoding="utf-8")
    print(f"Generated {len(statements)} D1 statements")


def main() -> None:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    export = commands.add_parser("export")
    export.add_argument("--origin", required=True)
    export.add_argument("--output", required=True)
    export.set_defaults(handler=export_legacy)
    sql = commands.add_parser("sql")
    sql.add_argument("--input", required=True)
    sql.add_argument("--output", required=True)
    sql.set_defaults(handler=migration_sql)
    args = parser.parse_args()
    args.handler(args)


if __name__ == "__main__":
    main()
