#!/usr/bin/env python3
"""Offline field/tasklist API contracts; no live tokens or HTTP calls."""
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location('fields_feishu_api', Path(__file__).resolve().parents[1] / 'feishu_api.py')
api = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(api)


def page(items=(), more=False, cursor=None):
    data = {'items': list(items), 'has_more': more}
    if cursor is not None:
        data['page_token'] = cursor
    return {'code': 0, 'data': data}


def field(name='State', kind='single_select', guid='field-1', options=None):
    f = {'name': name, 'type': kind, 'guid': guid}
    if kind in ('single_select', 'multi_select'):
        f[kind + '_setting'] = {'options': options or []}
    return f


class FieldsApiTests(unittest.TestCase):
    def run_actions(self, actions, responses):
        with patch.object(api, 'call', side_effect=responses) as call:
            results = api.run_actions('offline-not-a-credential', actions)
        return results, call

    def ensure(self, **kw):
        return dict(op='ensure_custom_field', tasklist='list-1', name='State', type='single_select', **kw)

    def set(self, **kw):
        return dict(op='set_custom_field', tasklist='list-1', task='task-1', name='State', value='Ready', **kw)

    def test_complete_pagination_and_quoted_cursor(self):
        results, call = self.run_actions([self.ensure()], [page([], True, 'a&b'), page([field()])])
        self.assertTrue(results[0]['ok'])
        self.assertFalse(results[0]['created'])
        self.assertIn('page_token=a%26b', call.call_args.args[1])
        self.assertEqual(call.call_count, 2)

    def test_lookup_fail_closed_no_post(self):
        bad = [{'code': 403, 'msg': 'denied'}, None, {'code': 0},
               {'code': 0, 'data': {'items': []}},
               {'code': False, 'data': {'items': [], 'has_more': False}},
               {'code': 0, 'data': {'items': [], 'has_more': 'false'}},
               {'code': 0, 'data': {'items': [], 'has_more': True}},
               {'code': 0, 'data': {'items': {}}}, page([{'name': 'State'}])]
        for response in bad:
            with self.subTest(response=response):
                results, call = self.run_actions([self.ensure()], [response])
                self.assertFalse(results[0]['ok'])
                self.assertEqual(call.call_count, 1)

    def test_cursor_cycle_and_second_page_error_fail_closed(self):
        for responses in [[page([], True, 'same'), page([], True, 'same')],
                          [page([], True, 'next'), {'code': 500, 'msg': 'error'}]]:
            results, call = self.run_actions([self.ensure()], responses)
            self.assertFalse(results[0]['ok'])
            self.assertEqual(call.call_count, 2)

    def test_duplicate_name_on_later_page_rejected(self):
        results, call = self.run_actions([self.ensure()], [page([field()], True, 'next'), page([field(guid='field-2')])])
        self.assertFalse(results[0]['ok'])
        self.assertIn('重名', results[0]['error'])
        self.assertEqual(call.call_count, 2)

    def test_ensure_type_conflict_and_unsupported_no_writes(self):
        results, call = self.run_actions([self.ensure()], [page([field(kind='text')])])
        self.assertFalse(results[0]['ok'])
        self.assertEqual(call.call_count, 1)
        action = self.ensure()
        action['type'] = 'number'
        results, call = self.run_actions([action], [])
        self.assertFalse(results[0]['ok'])
        call.assert_not_called()

    def test_ensure_same_type_backfills_and_preserves_hidden_guids(self):
        options = [{'guid': 'old', 'name': 'Ready', 'color_index': 2},
                   {'guid': 'hidden', 'name': 'Archived', 'is_hidden': True, 'color_index': 4}]
        after = field(options=options + [{'guid': 'new', 'name': 'New'}])
        results, call = self.run_actions([self.ensure(options=['Ready', 'New', 'New'])],
                                        [page([field(options=options)]), {'code': 0, 'data': {'custom_field': after}}])
        self.assertTrue(results[0]['ok'])
        self.assertEqual(results[0]['added'], ['New'])
        merged = call.call_args.kwargs['body']['custom_field']['single_select_setting']['options']
        self.assertEqual(merged[:2], options)
        self.assertEqual(merged[2:], [{'name': 'New'}])

    def test_hidden_same_name_warns_instead_of_failing_field(self):
        hidden = [{'guid': 'hidden', 'name': 'Ready', 'is_hidden': True}]
        results, call = self.run_actions([self.ensure(options=['Ready'])], [page([field(options=hidden)])])
        self.assertTrue(results[0]['ok'])
        self.assertIn('隐藏', ' '.join(results[0]['warnings']))
        self.assertEqual(call.call_count, 1)

    def test_duplicate_required_option_warns_without_patch(self):
        options = [{'guid': 'a', 'name': 'Ready'}, {'guid': 'b', 'name': 'Ready'}]
        results, call = self.run_actions([self.ensure(options=['Ready'])], [page([field(options=options)])])
        self.assertTrue(results[0]['ok'])
        self.assertIn('同名可见选项重复', ' '.join(results[0]['warnings']))
        self.assertEqual(call.call_count, 1)

    def test_ensure_creation_settings_and_receipt(self):
        for kind, setting in [('multi_select', 'multi_select_setting'), ('text', 'text_setting'), ('datetime', 'datetime_setting')]:
            action = self.ensure(options=['A'])
            action['type'] = kind
            results, call = self.run_actions([action], [page(), {'code': 0, 'data': {'custom_field': field(kind=kind, options=[{'name': 'A', 'guid': 'option-a'}])}}])
            self.assertTrue(results[0]['ok'])
            self.assertTrue(results[0]['created'])
            self.assertIn(setting, call.call_args.kwargs['body'])
        results, _ = self.run_actions([self.ensure()], [page(), {'code': 0, 'data': {}}])
        self.assertFalse(results[0]['ok'])
        self.assertTrue(results[0]['unknownDelivery'])

    def test_creation_receipt_missing_option_or_invalid_guid_is_unknown(self):
        for target in [field(), field(guid=42)]:
            results, call = self.run_actions([self.ensure(options=['Ready'])], [page(), {'code': 0, 'data': {'custom_field': target}}])
            self.assertFalse(results[0]['ok'])
            self.assertTrue(results[0]['unknownDelivery'])
            self.assertEqual(call.call_count, 2)

    def test_set_name_ambiguity_and_field_guid_type_validation(self):
        dup = [field(kind='text'), field(kind='text', guid='field-2')]
        results, call = self.run_actions([self.set()], [page(dup)])
        self.assertFalse(results[0]['ok'])
        self.assertEqual(call.call_count, 1)
        results, call = self.run_actions([self.set(field_guid='field-2', expected_type='text')], [page(dup), {'code': 0}])
        self.assertTrue(results[0]['ok'])
        self.assertEqual(call.call_args.kwargs['body']['task']['custom_fields'][0]['guid'], 'field-2')
        for kw in [{'field_guid': 'missing', 'expected_type': 'text'},
                   {'field_guid': 'field-1', 'expected_type': 'datetime'}, {'expected_type': 'number'}]:
            results, call = self.run_actions([self.set(**kw)], [page([field(kind='text')])])
            self.assertFalse(results[0]['ok'])
            self.assertLessEqual(call.call_count, 1)

    def test_guid_name_mismatch_rejected(self):
        results, call = self.run_actions([self.set(field_guid='field-1', expected_type='text')], [page([field(name='Other', kind='text')])])
        self.assertFalse(results[0]['ok'])
        self.assertEqual(call.call_count, 1)

    def test_set_unsupported_type_and_lookup_failure_no_patch(self):
        for response in [page([field(kind='number')]), {'code': 403, 'msg': 'denied'}]:
            results, call = self.run_actions([self.set()], [response])
            self.assertFalse(results[0]['ok'])
            self.assertEqual(call.call_count, 1)

    def test_multi_select_uses_own_setting_and_multiple_values(self):
        opts = [{'guid': 'a', 'name': 'A'}, {'guid': 'h', 'name': 'Hidden', 'is_hidden': True}]
        after = field(kind='multi_select', options=opts + [{'guid': 'b', 'name': 'B'}])
        action = self.set(expected_type='multi_select')
        action['value'] = ['A', 'B']
        results, call = self.run_actions([action], [page([field(kind='multi_select', options=opts)]),
                                                   {'code': 0, 'data': {'custom_field': after}}, {'code': 0}])
        self.assertTrue(results[0]['ok'])
        self.assertEqual(call.call_args_list[1].kwargs['body']['update_fields'], ['multi_select_setting'])
        self.assertEqual(call.call_args.kwargs['body']['task']['custom_fields'][0]['multi_select_value'], ['a', 'b'])

    def test_clear_select_never_adds_empty_option(self):
        for kind in ['single_select', 'multi_select']:
            for value in ['', None, []]:
                action = self.set()
                action['value'] = value
                results, call = self.run_actions([action], [page([field(kind=kind)]), {'code': 0}])
                self.assertTrue(results[0]['ok'])
                self.assertEqual(call.call_count, 2)
                f = call.call_args.kwargs['body']['task']['custom_fields'][0]
                self.assertEqual(f[kind + '_value'], '' if kind == 'single_select' else [])

    def test_patch_failure_and_bad_option_receipt_prevent_task_write(self):
        for response in [{'code': 403, 'msg': 'denied'}, {'code': 0, 'data': {}},
                         {'code': 0, 'data': {'custom_field': field(options=[{'guid': 'a', 'name': 'Other'}])}}]:
            results, call = self.run_actions([self.set()], [page([field()]), response])
            self.assertFalse(results[0]['ok'])
            self.assertEqual(call.call_count, 2)

    def test_failed_ensure_blocks_same_batch_set_only(self):
        other = self.set()
        other['name'] = 'Other'
        results, call = self.run_actions([self.ensure(), self.set(field_guid='field-1', expected_type='text'), other],
                                        [page([field(kind='text')]), page([field(name='Other', kind='text')]), {'code': 0}])
        self.assertFalse(results[0]['ok'])
        self.assertFalse(results[1]['ok'])
        self.assertEqual(results[1]['skipped'], 'ensure_failed')
        self.assertTrue(results[2]['ok'])
        self.assertEqual(call.call_count, 3)

    def test_guid_only_set_also_respects_failed_ensure(self):
        action = self.set(field_guid='field-1')
        del action['name']
        results, call = self.run_actions([self.ensure(), action],
                                        [page([field(kind='text')]), page([field(kind='text')])])
        self.assertFalse(results[1]['ok'])
        self.assertEqual(results[1]['skipped'], 'ensure_failed')
        self.assertEqual(call.call_count, 2)

    def test_select_malformed_settings_no_writes(self):
        for target in [dict(name='State', type='single_select', guid='field-1'),
                       field(options=[{'name': 'Missing guid'}])]:
            results, call = self.run_actions([self.ensure()], [page([target])])
            self.assertFalse(results[0]['ok'])
            self.assertEqual(call.call_count, 1)

    def test_hidden_or_duplicate_option_name_cannot_be_set(self):
        for options in [[{'guid': 'h', 'name': 'Ready', 'is_hidden': True}],
                        [{'guid': 'a', 'name': 'Ready'}, {'guid': 'b', 'name': 'Ready'}]]:
            results, call = self.run_actions([self.set()], [page([field(options=options)])])
            self.assertFalse(results[0]['ok'])
            self.assertEqual(call.call_count, 1)

    def test_read_tolerates_legacy_blank_and_duplicate_option_names(self):
        options = [{'guid': 'a', 'name': 'P0'}, {'guid': 'b', 'name': ''},
                   {'guid': 'c', 'name': 'P0'}, {'name': 'missing-guid'}]
        with patch.object(api, 'call', return_value=page([field(options=options)])):
            fields = api.list_custom_fields('offline', 'list-1')
        self.assertEqual(len(fields), 1)
        self.assertEqual(api.options_of(fields[0]), {'a': 'P0', 'b': '', 'c': 'P0'})

    def test_write_still_rejects_ambiguous_legacy_option(self):
        options = [{'guid': 'a', 'name': 'P0'}, {'guid': 'c', 'name': 'P0'}]
        action = self.set()
        action['value'] = 'P0'
        results, call = self.run_actions([action], [page([field(options=options)])])
        self.assertFalse(results[0]['ok'])
        self.assertIn('重名', results[0]['error'])
        self.assertEqual(call.call_count, 1)

    def test_main_fields_complete_and_errors_exposed(self):
        payload = {'fields': ['list-1', 'list-2']}
        with patch.object(api, 'load_token', return_value='offline'), patch.object(api, 'call', side_effect=[
                page([field()], True, 'next'), page([field(name='Later', kind='text', guid='later')]),
                page([field()], True, 'next'), {'code': 403, 'msg': 'denied'}]), \
                patch('sys.stdin', io.StringIO(json.dumps(payload))), patch('sys.stdout', new_callable=io.StringIO) as stdout:
            api.main()
        result = json.loads(stdout.getvalue())
        self.assertEqual(len(result['fields']['list-1']), 2)
        self.assertNotIn('list-2', result['fields'])
        self.assertIn('fields list-2', result['errors'][0])


class TasklistApiTests(unittest.TestCase):
    def run_action(self, action, responses):
        with patch.object(api, 'call', side_effect=responses) as call:
            result = api.run_actions('offline', [dict(op='ensure_tasklist', **action)])[0]
        return result, call

    def test_guid_get_does_not_require_matching_name(self):
        result, call = self.run_action({'guid': 'existing', 'name': 'Managed'}, [{'code': 0, 'data': {'tasklist': {'guid': 'existing', 'name': 'Renamed'}}}])
        self.assertTrue(result['ok'])
        self.assertEqual(result['name'], 'Renamed')
        self.assertFalse(result['created'])
        self.assertEqual(call.call_count, 1)

    def test_bad_guid_receipt_no_fallback_create(self):
        for response in [{'code': 404, 'msg': 'missing'}, {'code': 0, 'data': {}},
                         {'code': 0, 'data': {'tasklist': {'guid': 'wrong', 'name': 'Managed'}}}]:
            result, call = self.run_action({'guid': 'existing', 'name': 'Managed'}, [response])
            self.assertFalse(result['ok'])
            self.assertEqual(call.call_count, 1)

    def test_exact_unique_name_full_pagination(self):
        result, call = self.run_action({'name': 'Managed'}, [page([{'guid': 'near', 'name': 'Managed extra'}], True, 'next'),
                                                            page([{'guid': 'found', 'name': 'Managed'}])])
        self.assertTrue(result['ok'])
        self.assertEqual(result['guid'], 'found')
        self.assertFalse(result['created'])
        self.assertEqual(call.call_count, 2)

    def test_duplicate_name_and_failed_list_never_create(self):
        for responses in [[page([{'guid': 'a', 'name': 'Managed'}, {'guid': 'b', 'name': 'Managed'}])],
                          [{'code': 403, 'msg': 'denied'}], [page([], True, 'next'), page([], True, 'next')]]:
            result, call = self.run_action({'name': 'Managed'}, responses)
            self.assertFalse(result['ok'])
            self.assertTrue(all(c.kwargs.get('method', 'GET') == 'GET' for c in call.call_args_list))

    def test_create_official_client_token_contract(self):
        result, call = self.run_action({'name': 'Managed', 'create_token': 'stable-token'},
                                      [page(), {'code': 0, 'data': {'tasklist': {'guid': 'created', 'name': 'Managed'}}}])
        self.assertTrue(result['ok'])
        self.assertTrue(result['created'])
        self.assertEqual(result['guid'], 'created')
        call.assert_called_with('offline', '/task/v2/tasklists?user_id_type=open_id', method='POST',
                                body={'name': 'Managed', 'client_token': 'stable-token'})

    def test_create_timeout_unknown_no_retry_and_malformed_success(self):
        for response in [TimeoutError('timed out'), {'code': 0, 'data': {}}, {'code': 400, 'msg': 'invalid'},
                         {}, {'code': 503, 'msg': 'gateway timeout'}]:
            result, call = self.run_action({'name': 'Managed'}, [page(), response])
            self.assertFalse(result['ok'])
            self.assertEqual(call.call_count, 2)
            self.assertEqual(result.get('unknownDelivery', False), not isinstance(response, dict) or response.get('code') != 400)


if __name__ == '__main__':
    unittest.main(verbosity=2)
