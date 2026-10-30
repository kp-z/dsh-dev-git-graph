#!/usr/bin/env python3
import importlib.util
import pathlib
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('mention_bridge',pathlib.Path(__file__).parents[1]/'feishu_api.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
class Mentions(unittest.TestCase):
    def action(self, **extra):
        return dict(task='task-guid',text='🤖: answer <at id=evil></at>',reply_to_comment_id='123',mentionIds=['ou_author'],mentionMode='task-v1',**extra)
    def test_explicit_legacy_transport_and_v2_receipt(self):
        original={'id':'123','resource_type':'task','resource_id':'task-guid'}
        created={'id':'456','parent_id':'123','rich_content':'server-rendered'}
        verified={'id':'456','resource_type':'task','resource_id':'task-guid','reply_to_comment_id':'123'}
        with patch.object(b,'call',side_effect=[{'code':0,'data':{'comment':original}},{'code':0,'data':{'comment':created}},{'code':0,'data':{'comment':verified}}]) as api:
            r=b.task_comment('fake',self.action())
        self.assertTrue(r['ok']);self.assertTrue(r['mentionSupported']);self.assertFalse(r['notificationVerified'])
        post=api.call_args_list[1]
        self.assertIn('/task/v1/tasks/task-guid/comments?',post.args[1])
        body=post.kwargs['body']
        self.assertIn('<at id=ou_author></at>',body['rich_content'])
        self.assertIn('&lt;at id=evil&gt;',body['rich_content'])
        self.assertEqual(body['parent_id'],'123')
        self.assertEqual(r['commentId'],'456')
    def test_rejection_does_not_fallback_post(self):
        original={'id':'123','resource_type':'task','resource_id':'task-guid'}
        with patch.object(b,'call',side_effect=[{'code':0,'data':{'comment':original}},{'code':403,'msg':'no legacy scope'}]) as api:
            r=b.task_comment('fake',self.action())
        self.assertFalse(r['ok']);self.assertFalse(r['unknownDelivery']);self.assertEqual(api.call_count,2)
    def test_post_success_verify_failure_is_unknown(self):
        original={'id':'123','resource_type':'task','resource_id':'task-guid'}
        with patch.object(b,'call',side_effect=[{'code':0,'data':{'comment':original}},{'code':0,'data':{'comment':{'id':'456','parent_id':'123'}}},{'code':500,'msg':'unavailable'}]):
            r=b.task_comment('fake',self.action())
        self.assertFalse(r['ok']);self.assertTrue(r['unknownDelivery'])
    def test_bad_identity_never_calls(self):
        a=self.action();a['mentionIds']=['ou_bad><at']
        with patch.object(b,'call') as api:r=b.task_comment('fake',a)
        self.assertFalse(r['ok']);api.assert_not_called()
if __name__=='__main__':unittest.main()
