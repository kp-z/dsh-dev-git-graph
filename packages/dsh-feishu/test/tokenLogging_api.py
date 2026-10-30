#!/usr/bin/env python3
"""Offline check: suppress library logging before token retrieval; no real credentials."""
import importlib.util
import pathlib
import sys
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('bridge_token_logging', pathlib.Path(__file__).parents[1] / 'feishu_api.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

class TokenLoggingTests(unittest.TestCase):
    def test_logging_disabled_before_lookup(self):
        events = []
        logger = types.SimpleNamespace(remove=lambda: events.append('silenced'))
        def lookup():
            self.assertEqual(events, ['silenced'])
            events.append('lookup')
            return 'fake-not-a-credential', 10
        modules = {'feishu_sync': types.ModuleType('feishu_sync'), 'feishu_sync.retoken': types.SimpleNamespace(get_access_token=lookup), 'loguru': types.SimpleNamespace(logger=logger)}
        with patch.dict(sys.modules, modules):
            self.assertEqual(bridge.load_token(), 'fake-not-a-credential')
        self.assertEqual(events, ['silenced', 'lookup'])

if __name__ == '__main__':
    unittest.main()
