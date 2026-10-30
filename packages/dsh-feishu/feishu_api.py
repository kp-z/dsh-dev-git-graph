#!/usr/bin/env python3
"""飞书 Open API 补充通道（给 dsh-feishu 宿主半体调用）。

## 为什么需要它

`feishu-sync-cli` 覆盖了任务列表 / 文档读取，但不提供：清单名字、自定义字段定义
（选项 guid → 文字）、用户头像与姓名。这三样恰好是「按清单字段配置 + 卡片对齐飞书」
所需的。与其在 Node 侧重写一遍 OAuth，不如复用 feishu-sync 已经维护好的 token：

    python feishu_api.py enrich   # stdin 收 JSON，stdout 吐 JSON

stdin:
    {"tasklists": ["guid..."], "fields": ["tasklist guid..."], "users": ["ou_..."]}
stdout:
    {"ok": true,
     "tasklists": {"<guid>": "<名字>"},
     "fields": {"<tasklist guid>": [{"guid","name","type","options":{"<option guid>":"<名字>"}}]},
     "users": {"<ou_id>": {"name": "...", "avatar": "https://..."}},
     "errors": ["..."]}

任何一部分失败都不影响其它部分：errors 里记原因，调用方按缺失处理。
"""
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = 'https://open.feishu.cn/open-apis'


def load_token():
    try:
        from feishu_sync.retoken import get_access_token
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f'feishu_sync 不可用：{exc}') from exc
    token, _ttl = get_access_token()
    try:
        from loguru import logger
        logger.remove()
    except Exception:  # noqa: BLE001
        pass
    return token


def call(token, path, method='GET', body=None):
    data = None
    headers = {'Authorization': 'Bearer ' + token}
    if body is not None:
        data = json.dumps(body).encode()
        headers['content-type'] = 'application/json; charset=utf-8'
    req = urllib.request.Request(BASE + path, headers=headers, data=data, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as exc:
        return {'code': exc.code, 'msg': exc.read().decode()[:300]}


def ensure_folder(token, name, parent=''):
    """在 parent（空=根目录）下找同名文件夹，没有就建一个。"""
    res = call(token, f'/drive/v1/files?folder_token={parent}&page_size=200')
    for item in ((res.get('data') or {}).get('files') or []):
        if item.get('type') == 'folder' and item.get('name') == name:
            return item.get('token'), item.get('url')
    res = call(token, '/drive/v1/files/create_folder', method='POST', body={'name': name, 'folder_token': parent})
    item = res.get('data') or {}
    return item.get('token'), item.get('url')


MAX_BLOCK_CHARS = 900


INLINE_RE = __import__('re').compile(r'(\*\*.+?\*\*|`[^`]+`|(?<!\*)\*[^*]+\*(?!\*))')
TABLE_SEP = __import__('re').compile(r'^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$')


def _elements(text):
    out, pos = [], 0
    for m in INLINE_RE.finditer(text):
        if m.start() > pos:
            out.append({'text_run': {'content': text[pos:m.start()]}})
        token = m.group(0)
        if token.startswith('**'):
            out.append({'text_run': {'content': token[2:-2], 'text_element_style': {'bold': True}}})
        elif token.startswith('`'):
            out.append({'text_run': {'content': token[1:-1], 'text_element_style': {'inline_code': True}}})
        else:
            out.append({'text_run': {'content': token[1:-1], 'text_element_style': {'italic': True}}})
        pos = m.end()
    if pos < len(text):
        out.append({'text_run': {'content': text[pos:]}})
    return out or [{'text_run': {'content': text}}]


def _cells(line):
    return [c.strip() for c in line.strip().strip('|').split('|')]


def parse_blocks(markdown):
    """Markdown → [{'kind': 'block', 'block': {...}} | {'kind': 'table', 'rows': [[...]]}]"""
    items, in_code, code_buf, table_buf = [], False, [], []

    def flush_table():
        nonlocal table_buf
        if len(table_buf) >= 2:
            rows = [_cells(r) for r in table_buf if not TABLE_SEP.match(r.strip())]
            if rows:
                items.append({'kind': 'table', 'rows': rows})
        else:
            for r in table_buf:
                items.append({'kind': 'block', 'block': {'block_type': 2, 'text': {'elements': _elements(' · '.join(_cells(r)))}}})
        table_buf = []

    for raw in markdown.split('\n'):
        line = raw.rstrip()
        if line.strip().startswith('```'):
            if in_code:
                items.append({'kind': 'block', 'block': {'block_type': 14, 'code': {'elements': _elements('\n'.join(code_buf)), 'style': {'language': 1}}}})
                code_buf, in_code = [], False
            else:
                in_code = True
            continue
        if in_code:
            code_buf.append(line)
            continue
        stripped = line.strip()
        if stripped.startswith('|'):
            table_buf.append(stripped)
            continue
        if table_buf:
            flush_table()
        if not stripped or TABLE_SEP.match(stripped):
            continue
        if stripped.startswith('####'):
            items.append({'kind': 'block', 'block': {'block_type': 6, 'heading4': {'elements': _elements(stripped.lstrip('# ').strip())}}})
        elif stripped.startswith('###'):
            items.append({'kind': 'block', 'block': {'block_type': 5, 'heading3': {'elements': _elements(stripped.lstrip('# ').strip())}}})
        elif stripped.startswith('##'):
            items.append({'kind': 'block', 'block': {'block_type': 4, 'heading2': {'elements': _elements(stripped.lstrip('# ').strip())}}})
        elif stripped.startswith('#'):
            items.append({'kind': 'block', 'block': {'block_type': 3, 'heading1': {'elements': _elements(stripped.lstrip('# ').strip())}}})
        elif stripped.startswith('- ') or stripped.startswith('* '):
            items.append({'kind': 'block', 'block': {'block_type': 12, 'bullet': {'elements': _elements(stripped[2:].strip())}}})
        else:
            items.append({'kind': 'block', 'block': {'block_type': 2, 'text': {'elements': _elements(stripped)}}})
    if in_code and code_buf:
        items.append({'kind': 'block', 'block': {'block_type': 14, 'code': {'elements': _elements('\n'.join(code_buf)), 'style': {'language': 1}}}})
    if table_buf:
        flush_table()
    return items[:80]


def write_markdown(token, doc, markdown):
    """把 Markdown 写进文档：普通块批量插入，表格块先建表格再逐格填字。"""
    items = parse_blocks(markdown)
    plain = [it['block'] for it in items if it['kind'] == 'block']
    if plain:
        call(token, f'/docx/v1/documents/{doc}/blocks/{doc}/children',
             method='POST', body={'children': plain})
    made = 0
    for it in items:
        if it['kind'] != 'table':
            continue
        rows = [r for r in it['rows']]
        cols = max(len(r) for r in rows)
        rows = [r + [''] * (cols - len(r)) for r in rows]
        res = call(token, f'/docx/v1/documents/{doc}/blocks/{doc}/children', method='POST', body={'children': [{
            'block_type': 31,
            'table': {'property': {'row_size': len(rows), 'column_size': cols, 'header_row': True}},
        }]})
        table_block = ((res.get('data') or {}).get('children') or [{}])[0]
        cell_ids = table_block.get('children') or []
        if not cell_ids:
            continue
        for idx, cell_id in enumerate(cell_ids):
            text = rows[idx // cols][idx % cols]
            if not text:
                continue
            call(token, f'/docx/v1/documents/{doc}/blocks/{cell_id}/children', method='POST', body={'children': [{
                'block_type': 2, 'text': {'elements': _elements(text)},
            }]})
        made += 1
    return {'ok': True, 'tables': made, 'blocks': len(plain)}


def clear_doc(token, doc):
    blocks = call(token, f'/docx/v1/documents/{doc}/blocks?page_size=500')
    items = ((blocks.get('data') or {}).get('items') or [])[1:]
    if items:
        call(token, f'/docx/v1/documents/{doc}/blocks/{doc}/children/batch_delete',
             method='DELETE', body={'start_index': 0, 'end_index': len(items)})


# Official protocol evidence (public sources, no credential or live-write tests):
# https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/task-v2/comment/create
# https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/task-v2/comment/get
# larksuite/oapi-sdk-python: task/v2/model/{input_comment,comment,list_comment_request}.py
# @larksuiteoapi/node-sdk 1.76.0: types/index.d.ts, task.v2.comment
# IDs and ms timestamps are strings on the wire; creator is Member{id,type,role,name}.
# Create has no uid/idempotency field. No task-comment mention format is documented.
COMMENT_MAX_PAGES = 100


def _comment_resource(item):
    """Keep the actual resource, with lossless IDs (Python SDK also accepts ints)."""
    if not isinstance(item, dict):
        raise ValueError('评论资源不是对象')
    out = dict(item)
    for key in ('id', 'reply_to_comment_id', 'created_at', 'updated_at'):
        value = out.get(key)
        if value is not None:
            if isinstance(value, bool) or not isinstance(value, (str, int)):
                raise ValueError(f'评论 {key} 类型无效')
            out[key] = str(value)
    if not out.get('id') or not out['id'].isascii() or not out['id'].isdigit():
        raise ValueError('评论资源缺少有效稳定 ID')
    return out


def task_comments(token, action):
    """Bounded full listing: partial data is useful but never a success receipt."""
    result = {'op': 'task_comments', 'ok': False, 'items': [], 'has_more': True,
              'page_token': action.get('page_token') or '', 'incomplete': True,
              'pages': 0, 'user_id_type': 'open_id', 'error': None}
    try:
        max_pages = action.get('max_pages', 20)
        if isinstance(max_pages, bool) or not isinstance(max_pages, int) or not 1 <= max_pages <= COMMENT_MAX_PAGES:
            raise ValueError(f'max_pages 必须为 1–{COMMENT_MAX_PAGES} 的整数')
        direction = action.get('direction', 'asc')
        if direction not in ('asc', 'desc'):
            raise ValueError('direction 必须为 asc/desc')
        task = action['task']
        if not isinstance(task, str) or not task or len(task) > 100:
            raise ValueError('task 必须为非空任务 GUID（最多100字符）')
        seen_tokens, seen_ids = set(), set()
        for _ in range(max_pages):
            cursor = result['page_token']
            if not isinstance(cursor, str):
                raise ValueError('page_token 必须为字符串')
            seen_tokens.add(cursor)
            query = {'resource_type': 'task', 'resource_id': task, 'page_size': 50,
                     'user_id_type': 'open_id', 'direction': direction}
            if cursor:
                query['page_token'] = cursor
            res = call(token, '/task/v2/comments?' + urllib.parse.urlencode(query))
            if res.get('code') != 0:
                raise RuntimeError(str(res.get('msg') or res.get('code') or '评论读取失败'))
            data = res.get('data')
            if not isinstance(data, dict) or not isinstance(data.get('items'), list) or not isinstance(data.get('has_more'), bool):
                raise ValueError('评论分页响应缺少 items/has_more')
            if len(data['items']) > 50:
                raise ValueError('评论页超出请求的 page_size')
            page = [_comment_resource(item) for item in data['items']]
            for item in page:
                if item.get('resource_type') not in (None, 'task') or item.get('resource_id') not in (None, task):
                    raise ValueError('评论资源不属于当前任务')
                if item['id'] not in seen_ids:
                    seen_ids.add(item['id'])
                    result['items'].append(item)
            result['pages'] += 1
            result['has_more'] = data['has_more']
            result['page_token'] = data.get('page_token') or ''
            if not result['has_more']:
                result.update(ok=True, incomplete=False)
                return result
            if not isinstance(result['page_token'], str) or not result['page_token']:
                raise ValueError('has_more=true 但缺少 page_token')
            if result['page_token'] in seen_tokens:
                raise ValueError('评论分页 page_token 循环')
        raise ValueError('评论分页达到 max_pages 上限，数据不完整')
    except Exception as exc:  # noqa: BLE001
        result['error'] = str(exc)[:200]
        return result


def task_comment(token, action):
    """Create with an ID receipt; ambiguous POST delivery must not be retried."""
    result = {'op': 'task_comment', 'ok': False, 'commentId': None, 'comment': None,
              'unknownDelivery': False, 'user_id_type': 'open_id', 'error': None}
    posting = False
    try:
        # Do not silently turn a requested real mention into cosmetic @text.
        result['mentionSupported'] = False
        if action.get('mentions') or action.get('mentionIds') or action.get('mention_ids'):
            reply_requested = action.get('reply_to_comment_id', action.get('replyToCommentId'))
            if action.get('allowMentionFallback') is not True or not reply_requested:
                result['unsupported'] = 'mentions'
                raise ValueError('任务评论真实 mention 协议未获官方确认，不能发送假 @ 提及')
            result['warning'] = '真实 mention 未获官方协议确认；仅创建原生关联回复，不保证 @ 通知'
        if action.get('uid'):
            result['unsupported'] = 'uid'
            raise ValueError('官方任务评论创建协议没有 uid 幂等参数')
        task = action['task']
        if not isinstance(task, str) or not task or len(task) > 100:
            raise ValueError('task 必须为非空任务 GUID（最多100字符）')
        content = action.get('text', action.get('content'))
        if not isinstance(content, str) or not content.strip() or len(content) > 3000:
            raise ValueError('评论内容必须为非空字符串，最多3000个UTF-8字符')
        content.encode('utf-8')
        body = {'content': content, 'resource_type': 'task', 'resource_id': task}
        reply = action.get('reply_to_comment_id', action.get('replyToCommentId'))
        if reply is not None and reply != '':
            # InputComment explicitly uses a string, not the numeric Comment model.
            if not isinstance(reply, str) or not reply.isascii() or not reply.isdigit() or len(reply) > 20:
                raise ValueError('reply_to_comment_id 必须为最多20位的数字字符串')
            original = call(token, '/task/v2/comments/' + urllib.parse.quote(reply, safe='') + '?user_id_type=open_id')
            if original.get('code') != 0:
                raise RuntimeError(str(original.get('msg') or '无法核验被回复评论'))
            target = _comment_resource((original.get('data') or {}).get('comment'))
            if target.get('resource_type') != 'task' or target.get('resource_id') != task or target['id'] != reply:
                raise ValueError('被回复评论不属于当前任务')
            body['reply_to_comment_id'] = reply
        posting = True
        res = call(token, '/task/v2/comments?user_id_type=open_id', method='POST', body=body)
        if res.get('code') != 0:
            code = res.get('code')
            # A server failure can occur after commit. Only explicit client errors are unambiguous.
            result['unknownDelivery'] = not (isinstance(code, int) and (400 <= code < 500 or 1470400 <= code < 1470500))
            result['error'] = str(res.get('msg') or code or '评论创建失败')[:200]
            return result
        comment = _comment_resource((res.get('data') or {}).get('comment'))
        if comment.get('resource_type') != 'task' or comment.get('resource_id') != task:
            raise ValueError('评论创建回执资源不属于当前任务')
        if reply and comment.get('reply_to_comment_id') != reply:
            raise ValueError('评论创建回执回复关联不匹配')
        result.update(ok=True, commentId=comment['id'], comment=comment)
        return result
    except Exception as exc:  # noqa: BLE001
        result['unknownDelivery'] = posting
        result['error'] = str(exc)[:200]
        return result


def run_actions(token, actions):
    """CLI 没覆盖的写操作：任务挂清单、建文档目录、写文档、回写任务描述。"""
    results = []
    for action in actions or []:
        op = action.get('op')
        try:
            if op == 'add_tasklist':
                res = call(token, f"/task/v2/tasks/{action['task']}/add_tasklist?user_id_type=open_id",
                           method='POST', body={'tasklist_guid': action['tasklist']})
                ok = res.get('code') == 0
                results.append({'op': op, 'ok': ok, 'error': None if ok else res.get('msg', '')[:200]})
            elif op == 'task_get':
                task_id = urllib.parse.quote(str(action['task']), safe='')
                res = call(token, f'/task/v2/tasks/{task_id}?user_id_type=open_id')
                task = (res.get('data') or {}).get('task')
                ok = res.get('code') == 0 and isinstance(task, dict) and task.get('guid') == action['task']
                results.append({'op': op, 'ok': ok, 'task': task if ok else None,
                                'user_id_type': 'open_id',
                                'error': None if ok else str(res.get('msg') or '任务权威回执缺失/不匹配')[:200]})
            elif op == 'task_comment':
                results.append(task_comment(token, action))
            elif op == 'task_comments':
                results.append(task_comments(token, action))
            elif op == 'task_dependencies':
                res = call(token, f"/task/v2/tasks/{action['task']}?user_id_type=open_id")
                ok = res.get('code') == 0
                task = ((res.get('data') or {}).get('task') or {})
                results.append({'op': op, 'ok': ok, 'items': task.get('dependencies') or [],
                                'error': None if ok else (res.get('msg') or '')[:200]})
            elif op in ('add_dependencies', 'remove_dependencies'):
                deps = action.get('dependencies') or []
                if not 1 <= len(deps) <= 50:
                    raise ValueError('dependencies 必须包含 1–50 项')
                if op == 'add_dependencies':
                    if any(d.get('type') not in ('prev', 'next') or not d.get('task_guid') for d in deps):
                        raise ValueError('依赖必须带 task_guid 和 prev/next type')
                    body = {'dependencies': [{'task_guid': d['task_guid'], 'type': d['type']} for d in deps]}
                else:
                    body = {'dependencies': [{'task_guid': d['task_guid']} for d in deps]}
                res = call(token, f"/task/v2/tasks/{action['task']}/{op}", method='POST', body=body)
                ok = res.get('code') == 0
                results.append({'op': op, 'ok': ok, 'items': (res.get('data') or {}).get('dependencies') or [],
                                'error': None if ok else (res.get('msg') or '')[:200]})
            elif op == 'ensure_folder':
                folder, url = ensure_folder(token, action['name'], action.get('parent', ''))
                results.append({'op': op, 'ok': bool(folder), 'folder': folder, 'url': url})
            elif op == 'create_docx':
                res = call(token, '/docx/v1/documents',
                           method='POST', body={'title': action['title'], 'folder_token': action.get('folder', '')})
                doc = ((res.get('data') or {}).get('document') or {}).get('document_id')
                if not doc:
                    results.append({'op': op, 'ok': False, 'error': res.get('msg', 'create failed')})
                    continue
                info = write_markdown(token, doc, action.get('text') or '')
                results.append({'op': op, 'ok': True, 'document': doc, **info,
                                'url': f'https://momenta.feishu.cn/docx/{doc}'})
            elif op == 'update_docx':
                doc = action['document']
                clear_doc(token, doc)
                info = write_markdown(token, doc, action.get('text') or '')
                results.append({'op': op, 'ok': True, 'document': doc, **info,
                                'url': f'https://momenta.feishu.cn/docx/{doc}'})
            elif op == 'rename_docx':
                # 改文档标题（任务改名 / 卡片上改文档名时用）。
                #
                # 只有一条路真能走通：docx 的**页面块**（root block，block_id == document_id）
                # 的 text 就是文档标题，改它等于改名，权限只要 `docx:document` 写。
                # 官方「Drive 改名」要 `docx:document:write_only`，个人令牌通常没授这个 scope，
                # 所以退路只作为兜底，失败时把两边的错误都带回去。
                doc = action['document']
                title = (action.get('title') or '').strip()[:120]
                if not title:
                    results.append({'op': op, 'ok': False, 'error': 'title 不能为空'})
                    continue
                errors = []
                res = call(token, f'/docx/v1/documents/{doc}/blocks/{doc}', method='PATCH',
                           body={'update_text_elements': {'elements': [{'text_run': {'content': title}}]}})
                if res.get('code') == 0:
                    results.append({'op': op, 'ok': True, 'title': title, 'via': 'page-block'})
                    continue
                errors.append('page-block: ' + str(res.get('msg') or res.get('code'))[:120])
                res = call(token, f'/drive/v1/files/{doc}?type=docx', method='PATCH',
                           body={'name': title})
                if res.get('code') == 0:
                    results.append({'op': op, 'ok': True, 'title': title, 'via': 'drive'})
                    continue
                errors.append('drive: ' + str(res.get('msg') or res.get('code'))[:160])
                results.append({'op': op, 'ok': False, 'title': title,
                                'error': '；'.join(errors)[:300]})
            elif op in ('task_subtasks', 'task_attachments'):
                # 没授权时把错误原样带回，调用方按该项降级，而不是整条失败。
                task = action['task']
                # 附件是资源型接口，子任务才是挂在任务下面的路径。
                path = {
                    'task_attachments': f'/task/v2/attachments?resource_type=task&resource_id={task}&page_size=50',
                    'task_subtasks': f'/task/v2/tasks/{task}/subtasks?page_size=50',
                }[op]
                res = call(token, path)
                ok = res.get('code') == 0
                items = ((res.get('data') or {}).get('items') or []) if ok else []
                results.append({'op': op, 'ok': ok, 'items': items,
                                'error': None if ok else (res.get('msg') or '')[:200]})
            elif op == 'set_custom_field':
                fields = call(token, f"/task/v2/custom_fields?resource_type=tasklist&resource_id={action['tasklist']}&page_size=50")
                items = ((fields.get('data') or {}).get('items') or [])
                target = next((f for f in items if f.get('name') == action['name']), None)
                if not target:
                    results.append({'op': op, 'ok': False, 'error': f"没有名为 {action['name']} 的字段"})
                    continue
                want = str(action['value'] or '')
                ftype = target.get('type')
                if ftype in ('single_select', 'multi_select'):
                    # 单选/多选要传选项 guid，不是文本；选项不存在就**带着现有 guid**追加一个，
                    # 显式传 guid 才不会把已有选项重建（重建会让所有任务上的旧值失效）。
                    visible = [o for o in ((target.get('single_select_setting') or {}).get('options') or [])
                               if not o.get('is_hidden')]
                    by_name = {o.get('name'): o.get('guid') for o in visible}
                    guid = by_name.get(want)
                    if not guid:
                        merged = [{'guid': o.get('guid'), 'name': o.get('name'),
                                   'color_index': o.get('color_index', 0)} for o in visible]
                        merged.append({'name': want})
                        patched = call(token, f"/task/v2/custom_fields/{target['guid']}", method='PATCH',
                                       body={'custom_field': {'single_select_setting': {'options': merged}},
                                             'update_fields': ['single_select_setting']})
                        if patched.get('code') != 0:
                            results.append({'op': op, 'ok': False,
                                            'error': ('追加选项失败：' + str(patched.get('msg')))[:160]})
                            continue
                        after = (((patched.get('data') or {}).get('custom_field') or {})
                                 .get('single_select_setting') or {}).get('options') or []
                        guid = next((o.get('guid') for o in after if o.get('name') == want), None)
                        if not guid:
                            results.append({'op': op, 'ok': False, 'error': '追加选项后没拿到 guid'})
                            continue
                    value = ({'single_select_value': guid} if ftype == 'single_select'
                             else {'multi_select_value': [guid]})
                    res = call(token, f"/task/v2/tasks/{action['task']}?user_id_type=open_id", method='PATCH',
                               body={'task': {'custom_fields': [dict(guid=target['guid'], type=ftype, **value)]},
                                     'update_fields': ['custom_fields']})
                    ok = res.get('code') == 0
                    results.append({'op': op, 'ok': ok, 'option': want,
                                    'error': None if ok else (res.get('msg') or '')[:160]})
                    continue
                if ftype == 'datetime':
                    # 日期字段只收毫秒字符串，语义是「该日期 UTC 00:00:00」；传 text_value 会被忽略。
                    day = want.strip()[:10]
                    try:
                        import datetime as _dt
                        y, m, d = (int(x) for x in day.split('-'))
                        ms = int(_dt.datetime(y, m, d, tzinfo=_dt.timezone.utc).timestamp() * 1000)
                    except Exception:
                        results.append({'op': op, 'ok': False,
                                        'error': f"日期字段要 YYYY-MM-DD，收到 {want[:20]}"})
                        continue
                    res = call(token, f"/task/v2/tasks/{action['task']}?user_id_type=open_id", method='PATCH',
                               body={'task': {'custom_fields': [{'guid': target['guid'],
                                                                 'datetime_value': str(ms)}]},
                                     'update_fields': ['custom_fields']})
                    ok = res.get('code') == 0
                    results.append({'op': op, 'ok': ok, 'datetime': day,
                                    'error': None if ok else (res.get('msg') or '')[:160]})
                    continue
                res = call(token, f"/task/v2/tasks/{action['task']}?user_id_type=open_id", method='PATCH',
                           body={'task': {'custom_fields': [{'guid': target['guid'], 'type': target['type'],
                                                             'text_value': want}]},
                                 'update_fields': ['custom_fields']})
                ok = res.get('code') == 0
                results.append({'op': op, 'ok': ok, 'error': None if ok else (res.get('msg') or '')[:160]})
            elif op == 'ensure_select_options':
                # 把本地工作区名补进单选字段的选项里。**必须带 guid**：整表重写而不传 guid，
                # 飞书会把所有选项重建，已有任务上的旧值立刻失效。
                fields = call(token, f"/task/v2/custom_fields?resource_type=tasklist&resource_id={action['tasklist']}&page_size=100")
                target = next((f for f in ((fields.get('data') or {}).get('items') or [])
                               if f.get('name') == action['name']), None)
                if not target:
                    results.append({'op': op, 'ok': False, 'error': f"没有名为 {action['name']} 的字段"})
                    continue
                if target.get('type') not in ('single_select', 'multi_select'):
                    results.append({'op': op, 'ok': True, 'added': [], 'skipped': 'not_select'})
                    continue
                settings_key = 'single_select_setting' if target.get('type') == 'single_select' else 'multi_select_setting'
                visible = [o for o in ((target.get(settings_key) or {}).get('options') or [])
                           if not o.get('is_hidden')]
                names = {o.get('name') for o in visible}
                missing = [n for n in action.get('options') or [] if n and n not in names]
                if not missing:
                    results.append({'op': op, 'ok': True, 'added': []})
                    continue
                merged = [{'guid': o.get('guid'), 'name': o.get('name'),
                           'color_index': o.get('color_index', 0)} for o in visible]
                merged.extend({'name': n} for n in missing)
                patched = call(token, f"/task/v2/custom_fields/{target['guid']}", method='PATCH',
                               body={'custom_field': {settings_key: {'options': merged}},
                                     'update_fields': [settings_key]})
                ok = patched.get('code') == 0
                results.append({'op': op, 'ok': ok, 'added': missing if ok else [],
                                'error': None if ok else (patched.get('msg') or '')[:160]})
            elif op == 'ensure_custom_field':
                # 清单上还没有这个字段就建一个。**默认单选**（历史调用方都按单选传 options）；
                # 现在也支持 type='text' / 'datetime'：
                #   - 预期完成用 text（飞书自定义日期字段只到天，§DESIGN-task-lifecycle §10 实测）；
                #   - 开始/结束的日期列用 datetime。
                # 建字段接口是 POST /task/v2/custom_fields，body 带 resource_type/resource_id。
                fields = call(token, f"/task/v2/custom_fields?resource_type=tasklist&resource_id={action['tasklist']}&page_size=100")
                items = ((fields.get('data') or {}).get('items') or [])
                target = next((f for f in items if f.get('name') == action['name']), None)
                want_type = str(action.get('type') or 'single_select')
                options = [str(o) for o in (action.get('options') or []) if o]
                if target:
                    # 同名但类型不同：**不重建**（重建会让已有值失效），交给调用方降级。
                    same = target.get('type') == want_type
                    results.append({'op': op, 'ok': same, 'created': False,
                                    'guid': target.get('guid'), 'type': target.get('type'),
                                    'error': None if same
                                    else f"字段「{action['name']}」已存在但类型是 {target.get('type')}，不是 {want_type}"})
                    continue
                body = {
                    'resource_type': 'tasklist',
                    'resource_id': action['tasklist'],
                    'name': action['name'],
                    'type': want_type,
                }
                if want_type == 'single_select':
                    body['single_select_setting'] = {'options': [{'name': o} for o in options]}
                elif want_type == 'text':
                    body['text_setting'] = {}
                elif want_type == 'datetime':
                    body['datetime_setting'] = {'format': 'yyyy-mm-dd'}
                created = call(token, '/task/v2/custom_fields', method='POST', body=body)
                ok = created.get('code') == 0
                guid = (((created.get('data') or {}).get('custom_field') or {}).get('guid'))
                results.append({'op': op, 'ok': ok, 'created': True, 'guid': guid, 'type': want_type,
                                'error': None if ok else (created.get('msg') or '')[:160]})
            elif op == 'delete_custom_field':
                # 注意路径：不是 DELETE /task/v2/custom_fields/{guid}（那个是 404，v2 没这路由），
                # 而是 POST .../{guid}/remove，body 带 resource_type/resource_id。
                res = call(token, f"/task/v2/custom_fields/{action['guid']}/remove", method='POST',
                           body={'resource_type': 'tasklist', 'resource_id': action['tasklist']})
                ok = res.get('code') == 0
                results.append({'op': op, 'ok': ok, 'error': None if ok else (res.get('msg') or '')[:160]})
            elif op == 'delete_file':
                res = call(token, f"/drive/v1/files/{action['token']}?type={action.get('type', 'docx')}",
                           method='DELETE')
                ok = res.get('code') == 0
                results.append({'op': op, 'ok': ok, 'error': None if ok else (res.get('msg') or '')[:160]})
            elif op == 'append_description':
                res = call(token, f"/task/v2/tasks/{action['task']}?user_id_type=open_id")
                task = (res.get('data') or {}).get('task') or {}
                desc = task.get('description') or ''
                line = action['line']
                if line in desc:
                    results.append({'op': op, 'ok': True, 'skipped': True})
                    continue
                new_desc = (desc.rstrip() + '\n\n' + line).strip()
                res = call(token, f"/task/v2/tasks/{action['task']}?user_id_type=open_id",
                           method='PATCH', body={'task': {'description': new_desc}, 'update_fields': ['description']})
                ok = res.get('code') == 0
                results.append({'op': op, 'ok': ok, 'error': None if ok else res.get('msg', '')[:200]})
            elif op == 'set_task_time':
                # 写任务的开始/截止时间（AI 排期落地用）。
                # v2 的时间是**毫秒时间戳字符串**，不是秒、也不是对象；传错会被当成 1970 年，
                # 而且飞书不报错——只会静默把时间设歪，所以这里统一 int() 后转 str()。
                task_body = {}
                update_fields = []
                all_day = bool(action.get('isAllDay'))
                if action.get('start'):
                    task_body['start'] = {'timestamp': str(int(action['start'])), 'is_all_day': all_day}
                    update_fields.append('start')
                if action.get('due'):
                    task_body['due'] = {'timestamp': str(int(action['due'])), 'is_all_day': all_day}
                    update_fields.append('due')
                if not update_fields:
                    results.append({'op': op, 'ok': False, 'error': 'start/due 至少给一个'})
                    continue
                res = call(token, f"/task/v2/tasks/{action['task']}?user_id_type=open_id",
                           method='PATCH', body={'task': task_body, 'update_fields': update_fields})
                ok = res.get('code') == 0
                results.append({'op': op, 'ok': ok,
                                'error': None if ok else (res.get('msg') or '')[:160]})
            else:
                results.append({'op': op, 'ok': False, 'error': 'unsupported action'})
        except Exception as exc:  # noqa: BLE001
            results.append({'op': op, 'ok': False, 'error': str(exc)[:200]})
    return results


def options_of(field):
    settings = field.get('single_select_setting') or field.get('multi_select_setting') or {}
    return {opt.get('guid'): opt.get('name') for opt in (settings.get('options') or []) if opt.get('guid')}


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:  # noqa: BLE001
        payload = {}

    out = {'ok': True, 'tasklists': {}, 'fields': {}, 'users': {}, 'actions': [], 'errors': []}
    try:
        token = load_token()
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({'ok': False, 'errors': [str(exc)], 'tasklists': {}, 'fields': {}, 'users': {}}))
        return

    out['actions'] = run_actions(token, payload.get('actions'))

    for guid in payload.get('tasklists') or []:
        if not guid:
            continue
        res = call(token, f'/task/v2/tasklists/{guid}?user_id_type=open_id')
        item = (res.get('data') or {}).get('tasklist') or {}
        if res.get('code') == 0 and item.get('name'):
            out['tasklists'][guid] = item['name']
        else:
            out['errors'].append(f'tasklist {guid}: {res.get("msg") or res.get("code")}')

    for list_guid in payload.get('fields') or []:
        if not list_guid:
            continue
        res = call(
            token,
            f'/task/v2/custom_fields?resource_type=tasklist&resource_id={list_guid}&page_size=100',
        )
        if res.get('code') != 0:
            out['errors'].append(f'fields {list_guid}: {res.get("msg") or res.get("code")}')
            continue
        out['fields'][list_guid] = [
            {
                'guid': item.get('guid'),
                'name': item.get('name'),
                'type': item.get('type'),
                'options': options_of(item),
            }
            for item in (res.get('data') or {}).get('items', [])
        ]

    user_ids = [u for u in (payload.get('users') or []) if u]
    if user_ids:
        # 批量接口一次最多 50 个
        for start in range(0, len(user_ids), 50):
            chunk = user_ids[start:start + 50]
            query = '&'.join(f'user_ids={u}' for u in chunk)
            res = call(token, f'/contact/v3/users/batch?user_id_type=open_id&{query}')
            if res.get('code') != 0:
                out['errors'].append(f'users: {res.get("msg") or res.get("code")}')
                continue
            for item in (res.get('data') or {}).get('items', []):
                avatar = item.get('avatar') or {}
                out['users'][item.get('open_id')] = {
                    'name': item.get('name') or '',
                    'avatar': avatar.get('avatar_240') or avatar.get('avatar_640') or avatar.get('avatar_72') or '',
                }

    print(json.dumps(out, ensure_ascii=False))


if __name__ == '__main__':
    main()
