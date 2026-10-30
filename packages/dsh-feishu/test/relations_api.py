#!/usr/bin/env python3
"""Offline dependency API contract tests: all HTTP/token access is mocked."""
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

# Import production without creating pycache outside this test's write scope.
sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location('relations_feishu_api', Path(__file__).resolve().parents[1] / 'feishu_api.py')
api = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(api)


class RelationsApiTests(unittest.TestCase):
    def run_action(self, action, response=None):
        with patch.object(api, 'call', return_value=response or {'code': 0, 'data': {}}) as call:
            result = api.run_actions('offline-not-a-credential', [action])
        self.assertEqual(len(result), 1)
        return result[0], call

    def test_read_dependencies_uses_task_get_and_retains_prev_next(self):
        deps = [{'task_guid': 'before', 'type': 'prev'}, {'task_guid': 'after', 'type': 'next'}]
        result, call = self.run_action({'op': 'task_dependencies', 'task': 'current'}, {'code': 0, 'data': {'task': {'dependencies': deps}}})
        call.assert_called_once_with('offline-not-a-credential', '/task/v2/tasks/current?user_id_type=open_id')
        self.assertTrue(result['ok'])
        self.assertEqual(result['items'], deps)

    def test_read_no_dependencies_returns_empty(self):
        result, _ = self.run_action({'op': 'task_dependencies', 'task': 'current'})
        self.assertTrue(result['ok'])
        self.assertEqual(result['items'], [])

    def test_add_posts_guid_and_prev_next_only(self):
        result, call = self.run_action({'op': 'add_dependencies', 'task': 'current', 'dependencies': [
            {'task_guid': 'before', 'type': 'prev', 'reason': 'local-only'},
            {'task_guid': 'after', 'type': 'next', 'sessionId': 'local-only'},
        ]})
        call.assert_called_once_with('offline-not-a-credential', '/task/v2/tasks/current/add_dependencies', method='POST', body={
            'dependencies': [{'task_guid': 'before', 'type': 'prev'}, {'task_guid': 'after', 'type': 'next'}],
        })
        self.assertTrue(result['ok'])

    def test_remove_posts_guid_only_even_when_direction_metadata_supplied(self):
        result, call = self.run_action({'op': 'remove_dependencies', 'task': 'current', 'dependencies': [
            {'task_guid': 'before', 'type': 'prev', 'reason': 'ignored'},
            {'task_guid': 'after', 'type': 'next'},
        ]})
        call.assert_called_once_with('offline-not-a-credential', '/task/v2/tasks/current/remove_dependencies', method='POST', body={
            'dependencies': [{'task_guid': 'before'}, {'task_guid': 'after'}],
        })
        self.assertTrue(result['ok'])

    def test_remove_accepts_guid_without_direction(self):
        result, call = self.run_action({'op': 'remove_dependencies', 'task': 'current', 'dependencies': [{'task_guid': 'before'}]})
        self.assertTrue(result['ok'])
        self.assertEqual(call.call_args.kwargs['body'], {'dependencies': [{'task_guid': 'before'}]})

    def test_empty_and_oversized_mutations_reject_without_http(self):
        for op in ['add_dependencies', 'remove_dependencies']:
            for deps in [None, [], [{'task_guid': 'a', 'type': 'prev'}] * 51]:
                with self.subTest(op=op, deps=deps):
                    result, call = self.run_action({'op': op, 'task': 'current', 'dependencies': deps})
                    self.assertFalse(result['ok'])
                    self.assertIn('1–50', result['error'])
                    call.assert_not_called()

    def test_add_invalid_directions_and_missing_guids_reject(self):
        for dep in [{'task_guid': 'a', 'type': 'depends_on'}, {'task_guid': 'a'}, {'type': 'prev'}, {'task_guid': '', 'type': 'next'}]:
            with self.subTest(dep=dep):
                result, call = self.run_action({'op': 'add_dependencies', 'task': 'current', 'dependencies': [dep]})
                self.assertFalse(result['ok'])
                call.assert_not_called()

    def test_remove_missing_guid_rejects_without_http(self):
        result, call = self.run_action({'op': 'remove_dependencies', 'task': 'current', 'dependencies': [{}]})
        self.assertFalse(result['ok'])
        call.assert_not_called()

    def test_batch_limit_fifty_is_valid(self):
        for op in ['add_dependencies', 'remove_dependencies']:
            with self.subTest(op=op):
                deps = [{'task_guid': str(index), 'type': 'prev'} for index in range(50)]
                result, call = self.run_action({'op': op, 'task': 'current', 'dependencies': deps})
                self.assertTrue(result['ok'])
                self.assertEqual(len(call.call_args.kwargs['body']['dependencies']), 50)

    def test_remote_errors_are_reported_and_do_not_stop_other_actions(self):
        with patch.object(api, 'call', side_effect=[{'code': 403, 'msg': 'permission denied'}, {'code': 0, 'data': {'task': {'dependencies': []}}}]) as call:
            results = api.run_actions('offline-not-a-credential', [
                {'op': 'add_dependencies', 'task': 'current', 'dependencies': [{'task_guid': 'a', 'type': 'prev'}]},
                {'op': 'task_dependencies', 'task': 'current'},
            ])
        self.assertEqual(call.call_count, 2)
        self.assertFalse(results[0]['ok'])
        self.assertEqual(results[0]['error'], 'permission denied')
        self.assertTrue(results[1]['ok'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
