"""Unit tests for the Bedrock Agent action group handler."""

import importlib
import json
import os
import sys
import types
import unittest
from unittest.mock import patch


BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, BACKEND_DIR)

try:
    import boto3  # noqa: F401
except ModuleNotFoundError:
    sys.modules["boto3"] = types.SimpleNamespace(client=lambda *args, **kwargs: None)

tools = importlib.import_module("lambda.agent.tools")


class FakeDatabase:
    def __init__(self, rows):
        self.rows = rows
        self.last_parameters = None

    def query(self, sql, parameters=None):
        self.last_parameters = parameters
        return self.rows


class AgentToolsTest(unittest.TestCase):
    def test_get_shipment_risk_scopes_query_to_session_user(self):
        db = FakeDatabase([{"id": 7, "risk_level": "HIGH", "risk_score": 82}])
        event = {
            "messageVersion": "1.0",
            "actionGroup": "PortPulseReadTools",
            "function": "GetShipmentRisk",
            "parameters": [{"name": "shipmentId", "type": "integer", "value": "7"}],
            "sessionAttributes": {"userId": "user-123"},
            "promptSessionAttributes": {},
        }

        with patch.object(tools, "get_db", return_value=db):
            response = tools.handler(event, None)

        self.assertEqual(db.last_parameters, {"id": 7, "user_id": "user-123"})
        self.assertEqual(response["messageVersion"], "1.0")
        body = json.loads(
            response["response"]["functionResponse"]["responseBody"]["TEXT"]["body"]
        )
        self.assertTrue(body["ok"])
        self.assertEqual(body["data"]["shipment"]["risk_score"], 82)

    def test_missing_user_session_returns_reprompt(self):
        event = {
            "actionGroup": "PortPulseReadTools",
            "function": "GetShipmentRisk",
            "parameters": [{"name": "shipmentId", "value": "7"}],
        }

        with patch.object(tools, "get_db", return_value=FakeDatabase([])):
            response = tools.handler(event, None)

        function_response = response["response"]["functionResponse"]
        self.assertEqual(function_response["responseState"], "REPROMPT")

    def test_route_alias_and_news_limit_are_normalized(self):
        self.assertEqual(tools.normalize_route("부산 → 미주 서안"), "us_west")
        self.assertEqual(tools._bounded_int("50", 5, 1, 10), 10)


if __name__ == "__main__":
    unittest.main()
