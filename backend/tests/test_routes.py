"""Tests for the shared route catalog."""

import os
import sys
import unittest


BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, BACKEND_DIR)

from shared.routes import normalize_route, route_label


class RoutesTest(unittest.TestCase):
    def test_normalizes_user_facing_route_variants(self):
        self.assertEqual(normalize_route("미서안"), "us_west")
        self.assertEqual(normalize_route("부산 → 미주 서안"), "us_west")
        self.assertEqual(normalize_route("US_WEST"), "us_west")

    def test_unknown_route_is_not_silently_mapped(self):
        with self.assertRaises(ValueError):
            normalize_route("알 수 없는 항로")
        self.assertEqual(normalize_route("알 수 없는 항로", default="composite"), "composite")

    def test_returns_display_label(self):
        self.assertEqual(route_label("middle_east"), "중동")


if __name__ == "__main__":
    unittest.main()
