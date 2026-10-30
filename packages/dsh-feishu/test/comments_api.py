#!/usr/bin/env python3
"""Offline bridge tests: fake API only; never load tokens or write Feishu data."""
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('feishu_api', ROOT / 'feishu_api.py')
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)


def comment(cid='7197020628442939411', **fields):
    return {'id': cid, 'content': '测试内容',
            'creator': {'id': 'ou_author', 'type': 'user', 'role': 'creator', 'name': '作者'},
            'reply_to_comment_id': '', 'created_at': '1793359200000',
            'updated_at': '1793359200001', 'resource_type': 'task', 'resource_id': 'task-guid', **fields}


def page(items, more=False, cursor=''):
    return {'code': 0, 'data': {'items': items, 'has_more': more, 'page_token': cursor}}


class CommentsAPI(unittest.TestCase):
    def run_action(self, action, responses):
        with patch.object(api, 'load_token', side_effect=AssertionError('NO CREDENTIALS')), \
                patch.object(api, 'call', side_effect=responses) as fake:
            result = api.run_actions('fake-token-never-used', [action])[0]
        return result, fake

    def test_complete_pagination_preserves_resources_and_namespace(self):
        first = comment(7197020628442939411)
        second = comment('7197020628442939412', creator={'id': 'cli_app', 'type': 'app'})
        result, fake = self.run_action({'op': 'task_comments', 'task': 'task-guid'},
                                       [page([first], True, 'a+/& ?'), page([second])])
        self.assertTrue(result['ok'])
        self.assertFalse(result['incomplete'])
        self.assertFalse(result['has_more'])
        self.assertEqual(result['pages'], 2)
        self.assertEqual(result['items'][0]['id'], str(first['id']))
        self.assertEqual(result['items'][0]['created_at'], '1793359200000')
        self.assertEqual(result['items'][1]['creator'], second['creator'])
        query = parse_qs(urlsplit(fake.call_args_list[1].args[1]).query)
        self.assertEqual(query['page_token'], ['a+/& ?'])
        self.assertEqual(query['user_id_type'], ['open_id'])
        self.assertEqual(query['direction'], ['asc'])

    def test_limit_is_not_success_and_keeps_cursor(self):
        result, fake = self.run_action({'op': 'task_comments', 'task': 'task-guid', 'max_pages': 1},
                                       [page([comment()], True, 'next')])
        self.assertFalse(result['ok'])
        self.assertTrue(result['incomplete'])
        self.assertTrue(result['has_more'])
        self.assertEqual(result['page_token'], 'next')
        self.assertEqual(len(result['items']), 1)
        self.assertEqual(fake.call_count, 1)

    def test_second_page_error_retains_data_and_retry_cursor(self):
        for failure in ({'code': 403, 'msg': 'no permission'}, TimeoutError('offline timeout')):
            with self.subTest(failure=failure):
                result, _ = self.run_action({'op': 'task_comments', 'task': 'task-guid'},
                                            [page([comment()], True, 'next'), failure])
                self.assertFalse(result['ok'])
                self.assertTrue(result['incomplete'])
                self.assertEqual(result['page_token'], 'next')
                self.assertEqual(len(result['items']), 1)

    def test_missing_or_looping_cursor_is_incomplete(self):
        for responses in ([page([comment()], True)],
                          [page([comment()], True, 'x'), page([comment()], True, 'x')]):
            result, _ = self.run_action({'op': 'task_comments', 'task': 'task-guid'}, responses)
            self.assertFalse(result['ok'])
            self.assertTrue(result['incomplete'])
            self.assertEqual(len(result['items']), 1)

    def test_malformed_page_cannot_look_complete(self):
        for response in ({'code': 0, 'data': {'items': []}},
                         page([{'content': 'no id'}]), page([comment(resource_id='other')]),
                         page([comment()] * 51)):
            result, _ = self.run_action({'op': 'task_comments', 'task': 'task-guid'}, [response])
            self.assertFalse(result['ok'])
            self.assertTrue(result['incomplete'])

    def test_max_pages_is_bounded(self):
        for limit in (0, 101, True, '20'):
            result, fake = self.run_action({'op': 'task_comments', 'task': 'task-guid', 'max_pages': limit}, [])
            self.assertFalse(result['ok'])
            fake.assert_not_called()

    def test_plain_create_returns_stable_string_id_and_exact_body(self):
        created = comment(7197020628442939411)
        result, fake = self.run_action({'op': 'task_comment', 'task': 'task-guid', 'text': '🤖: 结论'},
                                       [{'code': 0, 'data': {'comment': created}}])
        self.assertTrue(result['ok'])
        self.assertEqual(result['commentId'], '7197020628442939411')
        self.assertFalse(result['unknownDelivery'])
        self.assertEqual(fake.call_args.kwargs['body'],
                         {'content': '🤖: 结论', 'resource_type': 'task', 'resource_id': 'task-guid'})
        self.assertEqual(fake.call_args.args[1], '/task/v2/comments?user_id_type=open_id')
        self.assertEqual(fake.call_args.kwargs['method'], 'POST')
        self.assertIn('7197020628442939411', json.dumps(result))

    def test_native_reply_checks_same_resource_and_string_reply_id(self):
        reply = '7197020628442939411'
        result, fake = self.run_action({'op': 'task_comment', 'task': 'task-guid', 'text': '答复',
                                       'reply_to_comment_id': reply},
                                      [{'code': 0, 'data': {'comment': comment(reply)}},
                                       {'code': 0, 'data': {'comment': comment('7197020628442939412', reply_to_comment_id=reply)}}])
        self.assertTrue(result['ok'])
        self.assertEqual(fake.call_args.kwargs['body']['reply_to_comment_id'], reply)
        self.assertEqual(fake.call_count, 2)

    def test_reply_to_other_task_or_inaccessible_comment_never_posts(self):
        for response in ({'code': 403, 'msg': 'denied'},
                         {'code': 0, 'data': {'comment': comment(resource_id='other')}}):
            result, fake = self.run_action({'op': 'task_comment', 'task': 'task-guid', 'text': '答复',
                                           'replyToCommentId': '7197020628442939411'}, [response])
            self.assertFalse(result['ok'])
            self.assertFalse(result['unknownDelivery'])
            self.assertEqual(fake.call_count, 1)

    def test_mentions_strict_and_explicit_native_reply_fallback(self):
        action = {'op': 'task_comment', 'task': 'task-guid', 'text': '答复', 'mentionIds': ['ou_author']}
        result, fake = self.run_action(action, [])
        self.assertFalse(result['ok'])
        self.assertEqual(result['unsupported'], 'mentions')
        fake.assert_not_called()
        result, fake = self.run_action(dict(action, allowMentionFallback=True), [])
        self.assertFalse(result['ok'])
        fake.assert_not_called()  # top-level mention still cannot fall back
        reply = '7197020628442939411'
        result, fake = self.run_action(dict(action, replyToCommentId=reply, allowMentionFallback=True),
                                      [{'code': 0, 'data': {'comment': comment()}},
                                       {'code': 0, 'data': {'comment': comment('7197020628442939412', reply_to_comment_id=reply)}}])
        self.assertTrue(result['ok'])
        self.assertFalse(result['mentionSupported'])
        self.assertIn('不保证', result['warning'])
        self.assertEqual(fake.call_args.kwargs['body']['content'], '答复')
        self.assertNotIn('mentions', fake.call_args.kwargs['body'])

    def test_missing_receipt_timeout_or_server_error_is_unknown_no_retry(self):
        for response in (TimeoutError('POST timeout'), {'code': 500, 'msg': 'server error'},
                         {'code': 1470500, 'msg': 'server error'}, {'code': 0, 'data': {}},
                         {'code': 0, 'data': {'comment': comment(resource_id='wrong')}}):
            result, fake = self.run_action({'op': 'task_comment', 'task': 'task-guid', 'text': '答复'}, [response])
            self.assertFalse(result['ok'])
            self.assertTrue(result['unknownDelivery'])
            self.assertIsNone(result['commentId'])
            self.assertEqual(fake.call_count, 1)

    def test_explicit_rejection_is_not_unknown(self):
        result, _ = self.run_action({'op': 'task_comment', 'task': 'task-guid', 'text': '答复'},
                                    [{'code': 1470403, 'msg': 'denied'}])
        self.assertFalse(result['ok'])
        self.assertFalse(result['unknownDelivery'])

    def test_invalid_content_reply_and_uid_never_calls_api(self):
        base = {'op': 'task_comment', 'task': 'task-guid', 'text': 'answer'}
        for extra in ({'text': ''}, {'text': 'x' * 3001}, {'reply_to_comment_id': 7197020628442939411},
                      {'reply_to_comment_id': 'x'}, {'uid': 'not-supported'}, {'text': '\ud800'}):
            result, fake = self.run_action(dict(base, **extra), [])
            self.assertFalse(result['ok'])
            self.assertFalse(result['unknownDelivery'])
            fake.assert_not_called()

    def test_task_get_authoritative_members_and_status_or_fail_closed(self):
        task = {'guid': 'task-guid', 'members': [{'id': 'ou_author', 'type': 'user', 'role': 'assignee'}],
                'completed_at': '0', 'creator': {'id': 'cli_app', 'type': 'app'}}
        result, fake = self.run_action({'op': 'task_get', 'task': 'task-guid'}, [{'code': 0, 'data': {'task': task}}])
        self.assertTrue(result['ok'])
        self.assertEqual(result['task'], task)
        self.assertEqual(fake.call_args.args[1], '/task/v2/tasks/task-guid?user_id_type=open_id')
        for response in ({'code': 403}, {'code': 0, 'data': {}}, {'code': 0, 'data': {'task': {'guid': 'other'}}}):
            result, _ = self.run_action({'op': 'task_get', 'task': 'task-guid'}, [response])
            self.assertFalse(result['ok'])
            self.assertIsNone(result['task'])

    def test_existing_dependencies_and_subtasks_remain_compatible(self):
        result, _ = self.run_action({'op': 'task_dependencies', 'task': 'task-guid'},
                                    [{'code': 0, 'data': {'task': {'dependencies': [{'type': 'prev', 'task_guid': 'a'}]}}}])
        self.assertTrue(result['ok'])
        self.assertEqual(result['items'][0]['type'], 'prev')
        result, _ = self.run_action({'op': 'task_subtasks', 'task': 'task-guid'}, [page([{'guid': 'child'}])])
        self.assertTrue(result['ok'])
        self.assertEqual(result['items'], [{'guid': 'child'}])


if __name__ == '__main__':
    unittest.main(verbosity=2)
