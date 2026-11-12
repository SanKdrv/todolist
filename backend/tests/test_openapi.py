"""Published OpenAPI contract for task schemas.

These assertions check generated JSON Schema, not just Python annotations:
optionality and nullability must match runtime validation.
"""

from app.main import app


def schema_for(name: str) -> dict:
    return app.openapi()["components"]["schemas"][name]


def test_task_update_contract_matches_runtime() -> None:
    schema = schema_for("TaskUpdate")
    properties = schema["properties"]

    assert schema["additionalProperties"] is False
    assert "required" not in schema

    # Optional but not nullable.
    assert properties["title"]["type"] == "string"
    assert "anyOf" not in properties["title"]
    assert properties["is_completed"]["type"] == "boolean"

    # Optional and nullable.
    description = properties["description"]
    if "anyOf" in description:
        description_types = {option["type"] for option in description["anyOf"]}
    else:
        description_types = set(description["type"])
    assert description_types == {"string", "null"}
