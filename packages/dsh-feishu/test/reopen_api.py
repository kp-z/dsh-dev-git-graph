#!/usr/bin/env python3
"""Offline task-reopen contracts: no credentials, network, or session actions."""
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import urllib.error

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location(
    'reopen_feishu_api', Path(__file__).resolve().parents[1] / 'feishu_api.py')
api = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(api)

GUID = '3c6273ca-eda9-489e-9f92-0050fe184831'
TOKEN = 'offline-not-a-credential'
PATH = f'/task/v2/tasks/{GUID}?user_id_type=open_id'
BODY = {'task': {'completed_at': '0'}, 'update_fields': ['completed_at']}


class ReopenApiTests(unittest.TestCase):
    def run_action(self, action=None, response=None):
        if action is None:
            action = {'op': 'task_reopen', 'task': GUID}
        with patch.object(api, 'load_token', side_effect=AssertionError('NO CREDENTIALS')), \
                patch.object(api.urllib.request, 'urlopen', side_effect=AssertionError('NO NETWORK')), \
                patch.object(api, 'call', side_effect=[response if response is not None else {'code': 0}]) as fake:
            results = api.run_actions(TOKEN, [action])
        self.assertEqual(len(results), 1)
        return results[0], fake

    def test_success_is_one_patch_only_completed_at_string_zero(self):
        result, fake = self.run_action(response={'code': 0, 'data': {'task': {
            'guid': GUID, 'completed_at': '0', 'summary': 'unchanged'}}})
        self.assertEqual(result, {'op': 'task_reopen', 'ok': True, 'error': None})
        fake.assert_called_once_with(TOKEN, PATH, method='PATCH', body=BODY)

    def test_other_input_fields_cannot_expand_write_scope(self):
        action = {'op': 'task_reopen', 'task': GUID, 'completed_at': '999',
                  'update_fields': ['summary', 'dependencies', 'due'],
                  'summary': 'never create', 'due': '999', 'start': '999',
                  'dependencies': [{'task_guid': 'other', 'type': 'prev'}],
                  'sessionId': 'never bind', 'followUp': True, 'taskId': 'other',
                  'body': {'task': {'summary': 'never write'}}}
        result, fake = self.run_action(action)
        self.assertTrue(result['ok'])
        fake.assert_called_once_with(TOKEN, PATH, method='PATCH', body=BODY)
        self.assertEqual(action['completed_at'], '999')  # input is not rewritten either

    def test_missing_invalid_or_injected_target_never_calls_api(self):
        invalid = [None, '', 'task-guid', 'T45', ' ' + GUID, GUID + ' ',
                   GUID + '\n', GUID + '/add_dependencies', GUID + '?other=1',
                   '../' + GUID, GUID.replace('-', ''), 123, True, [], {}]
        for task in invalid:
            with self.subTest(task=task):
                result, fake = self.run_action({'op': 'task_reopen', 'task': task})
                self.assertFalse(result['ok'])
                self.assertIn('GUID', result['error'])
                fake.assert_not_called()
        result, fake = self.run_action({'op': 'task_reopen', 'taskId': GUID})
        self.assertFalse(result['ok'])
        fake.assert_not_called()

    def test_valid_target_case_is_preserved_exactly(self):
        guid = GUID.upper()
        result, fake = self.run_action({'op': 'task_reopen', 'task': guid})
        self.assertTrue(result['ok'])
        fake.assert_called_once_with(TOKEN, f'/task/v2/tasks/{guid}?user_id_type=open_id',
                                     method='PATCH', body=BODY)

    def test_api_rejection_and_missing_code_are_errors_not_success(self):
        for response in ({'code': 403, 'msg': 'permission denied'},
                         {'code': 1470404, 'msg': 'not found'}, {'code': 500},
                         {'msg': 'missing code'}, {'code': '0'}):
            with self.subTest(response=response):
                result, fake = self.run_action(response=response)
                self.assertFalse(result['ok'])
                self.assertTrue(result['error'])
                fake.assert_called_once_with(TOKEN, PATH, method='PATCH', body=BODY)

    def test_transport_and_malformed_response_fail_without_retry(self):
        for response in (TimeoutError('offline timeout'), RuntimeError('offline failure'),
                         'not an object', []):
            with self.subTest(response=response):
                result, fake = self.run_action(response=response)
                self.assertFalse(result['ok'])
                self.assertTrue(result['error'])
                self.assertEqual(fake.call_count, 1)

    def test_repeat_reopen_is_idempotent_same_target_and_body(self):
        with patch.object(api, 'call', return_value={'code': 0}) as fake:
            results = api.run_actions(TOKEN, [{'op': 'task_reopen', 'task': GUID}] * 2)
        self.assertTrue(all(result['ok'] for result in results))
        self.assertEqual(fake.call_count, 2)
        for call in fake.call_args_list:
            self.assertEqual(call.args, (TOKEN, PATH))
            self.assertEqual(call.kwargs, {'method': 'PATCH', 'body': BODY})

    def test_failure_does_not_prevent_later_reopen(self):
        with patch.object(api, 'call', side_effect=[TimeoutError('timeout'), {'code': 0}]) as fake:
            results = api.run_actions(TOKEN, [{'op': 'task_reopen', 'task': GUID}] * 2)
        self.assertFalse(results[0]['ok'])
        self.assertTrue(results[1]['ok'])
        self.assertEqual(fake.call_count, 2)

    def test_existing_http_adapter_serializes_exact_patch(self):
        with patch.object(api, 'load_token', side_effect=AssertionError('NO CREDENTIALS')), \
                patch.object(api.urllib.request, 'urlopen') as fake:
            fake.return_value.__enter__.return_value = io.BytesIO(b'{"code":0}')
            result = api.run_actions(TOKEN, [{'op': 'task_reopen', 'task': GUID}])[0]
        self.assertTrue(result['ok'])
        fake.assert_called_once()
        req = fake.call_args.args[0]
        self.assertEqual(req.full_url, api.BASE + PATH)
        self.assertEqual(req.get_method(), 'PATCH')
        self.assertEqual(json.loads(req.data), BODY)
        self.assertEqual(fake.call_args.kwargs, {'timeout': 30})

    def test_http_error_returns_error_through_existing_adapter(self):
        failure = urllib.error.HTTPError(api.BASE + PATH, 403, 'Forbidden', {},
                                         io.BytesIO(b'{"msg":"denied"}'))
        with patch.object(api.urllib.request, 'urlopen', side_effect=failure) as fake:
            result = api.run_actions(TOKEN, [{'op': 'task_reopen', 'task': GUID}])[0]
        self.assertFalse(result['ok'])
        self.assertIn('denied', result['error'])
        fake.assert_called_once()


if __name__ == '__main__':
    unittest.main(verbosity=2)
