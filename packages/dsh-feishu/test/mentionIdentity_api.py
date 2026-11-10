import contextlib
import importlib.util
import io
import json
import pathlib
import unittest
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('mention_identity', pathlib.Path(__file__).parents[1] / 'feishu_api.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)

class Identity(unittest.TestCase):
    def invoke(self, response):
        output = io.StringIO()
        with patch.object(b.sys, 'stdin', io.StringIO(json.dumps({'self': True}))), patch.object(b, 'load_token', return_value='fake'), patch.object(b, 'call', return_value=response) as api, contextlib.redirect_stdout(output):
            b.main()
        self.assertEqual(api.call_args.args, ('fake', '/authen/v1/user_info'))
        return json.loads(output.getvalue())

    def test_identity(self):
        result = self.invoke({'code': 0, 'data': {'open_id': 'ou_self', 'name': 'secret-name', 'token': 'secret-token'}})
        self.assertEqual(result['self'], {'openId': 'ou_self'})
        self.assertNotIn('secret-token', json.dumps(result))

    def test_guarded_raw_comment_bridge_allowlist(self):
        for method, path, allowed in [('GET', '/open-apis/task/v2/comments/123', True), ('POST', '/open-apis/task/v1/tasks/task-guid/comments', True), ('POST', '/open-apis/drive/v1/files', False), ('DELETE', '/open-apis/task/v2/comments/123', False)]:
            output = io.StringIO()
            payload = {'commentApi': {'method': method, 'path': path, 'data': {'content': 'hello'}}}
            with patch.object(b.sys, 'stdin', io.StringIO(json.dumps(payload))), patch.object(b, 'load_token', return_value='fake'), patch.object(b, 'call', return_value={'code': 0, 'data': {'comment': {'id': 7702456459723833364, 'parent_id': 7702456459723833363}}}) as api, contextlib.redirect_stdout(output):
                b.main()
            result = json.loads(output.getvalue())['commentApi']
            self.assertEqual(result['ok'], allowed)
            self.assertEqual(api.call_count, int(allowed))
            if allowed:
                self.assertEqual(result['data']['comment']['id'], '7702456459723833364')
                self.assertEqual(result['data']['comment']['parent_id'], '7702456459723833363')
                self.assertEqual(api.call_args.args[1], path.removeprefix('/open-apis') + '?user_id_type=open_id')

    def test_missing_invalid_or_failed_identity(self):
        for response in [{'code': 403}, {'code': 0, 'data': {}}, {'code': 0, 'data': {'open_id': 'other'}}]:
            result = self.invoke(response)
            self.assertNotIn('self', result)
            self.assertTrue(result['errors'])

if __name__ == '__main__':
    unittest.main()
