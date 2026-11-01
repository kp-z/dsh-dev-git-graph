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
import html
import re
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
    # Silence credential-bearing library diagnostics BEFORE loading the token.
    try:
        from loguru import logger
        logger.remove()
    except Exception:  # noqa: BLE001
        pass
    token, _ttl = get_access_token()
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
        mentions = action.get('mentionIds') or action.get('mention_ids') or action.get('mentions') or []
        legacy_mention = action.get('mentionMode') == 'task-v1' and bool(mentions)
        if legacy_mention:
            if not isinstance(mentions, list) or len(mentions) > 5 or any(not isinstance(uid, str) or not re.fullmatch(r'ou_[A-Za-z0-9]+', uid) for uid in mentions):
                raise ValueError('任务提及只接受最多5个有效open_id')
            mentions = list(dict.fromkeys(mentions))
        if mentions and not legacy_mention:
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
        path = '/task/v2/comments?user_id_type=open_id'
        if legacy_mention:
            # Task v1's documented rich_content protocol, never injected into v2 content.
            # Same GUID/comment IDs verified against an isolated real task.
            rich = ' '.join('<at id=' + uid + '></at>' for uid in mentions)
            safe_content = html.escape(content, quote=False)
            rich_content = rich + '\n' + safe_content
            body = {'content': content, 'rich_content': rich_content, 'parent_id': reply or '0'}
            path = '/task/v1/tasks/' + urllib.parse.quote(task, safe='') + '/comments?user_id_type=open_id'
        posting = True
        res = call(token, path, method='POST', body=body)
        if res.get('code') != 0:
            code = res.get('code')
            # A server failure can occur after commit. Only explicit client errors are unambiguous.
            result['unknownDelivery'] = not (isinstance(code, int) and (400 <= code < 500 or 1470400 <= code < 1470500))
            result['error'] = str(res.get('msg') or code or '评论创建失败')[:200]
            return result
        comment = _comment_resource((res.get('data') or {}).get('comment'))
        if legacy_mention:
            if str(comment.get('parent_id', '0')) != (reply or '0'):
                raise ValueError('旧版评论回执回复关联不匹配')
            verified = call(token, '/task/v2/comments/' + urllib.parse.quote(comment['id'], safe='') + '?user_id_type=open_id')
            if verified.get('code') != 0:
                raise ValueError('旧版评论已提交，但v2回执对账失败')
            comment = _comment_resource((verified.get('data') or {}).get('comment'))
            result.update(mentionSupported=True, mentionTransport='task-v1', notificationVerified=False)
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


SUPPORTED_FIELD_TYPES = ('text', 'datetime', 'single_select', 'multi_select')


def _identifier(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f'{label} 不能为空')
    return value


def _api_data(res):
    if not isinstance(res, dict) or type(res.get('code')) is not int or res['code'] != 0:
        raise ValueError(str((res.get('msg') or res.get('code')) if isinstance(res, dict) else 'malformed API response'))
    data = res.get('data')
    if not isinstance(data, dict):
        raise ValueError('malformed API data')
    return data


def _list_all(token, path, kind):
    """Read all pages or raise; never expose a partial list to a writer."""
    items, seen, cursor = [], set(), None
    for _ in range(1000):
        query = path + ('&page_token=' + urllib.parse.quote(cursor, safe='') if cursor else '')
        data = _api_data(call(token, query))
        batch = data.get('items')
        more = data.get('has_more')
        if not isinstance(batch, list) or not isinstance(more, bool):
            raise ValueError(f'malformed {kind} page')
        for item in batch:
            if not isinstance(item, dict) or not all(isinstance(item.get(k), str) and item[k] for k in
                                                    (('guid', 'name', 'type') if kind == 'fields' else ('guid', 'name'))):
                raise ValueError(f'malformed {kind} item')
        items.extend(batch)
        if not more:
            return items
        cursor = data.get('page_token')
        if not isinstance(cursor, str) or not cursor.strip() or cursor in seen:
            raise ValueError(f'malformed {kind} pagination: missing/repeated cursor')
        seen.add(cursor)
    raise ValueError(f'{kind} pagination limit exceeded')


def list_custom_fields(token, tasklist):
    tasklist = _identifier(tasklist, 'tasklist')
    items = _list_all(token, '/task/v2/custom_fields?resource_type=tasklist&resource_id=' +
                      urllib.parse.quote(tasklist, safe='') + '&page_size=100', 'fields')
    for item in items:
        if item['type'] in ('single_select', 'multi_select'):
            _select_options(item, for_write=False)
    return items


def _field_target(items, action):
    guid = action.get('field_guid')
    name = action.get('name')
    if guid is not None:
        _identifier(guid, 'field_guid')
        matches = [f for f in items if f['guid'] == guid]
    else:
        _identifier(name, 'name')
        matches = [f for f in items if f['name'] == name]
    if len(matches) != 1:
        raise ValueError('字段重名/重复 GUID，拒绝写入' if len(matches) > 1 else '没有匹配的字段')
    target = matches[0]
    if guid is not None and name is not None and target['name'] != name:
        raise ValueError('field_guid 与 name 不匹配')
    expected = action.get('expected_type')
    if target['type'] not in SUPPORTED_FIELD_TYPES:
        raise ValueError('不支持字段类型 ' + target['type'])
    if expected is not None and (expected not in SUPPORTED_FIELD_TYPES or target['type'] != expected):
        raise ValueError('字段类型与 expected_type 不匹配')
    return target


def _option_names(value):
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError('options 必须是字符串数组')
    if any(not isinstance(n, str) for n in value):
        raise ValueError('options 必须是字符串数组')
    return list(dict.fromkeys(n for n in value if n.strip()))


def _select_options(target, for_write=False):
    """Read tolerantly, write strictly.

    Legacy lists legitimately contain blank-named or repeated option names; failing the
    whole field-definition read over them hides every other field (and turns select
    values into raw GUIDs). Reads therefore skip unusable options, while any write to
    that field still raises instead of guessing.
    """
    key = target['type'] + '_setting'
    setting = target.get(key)
    if not isinstance(setting, dict) or not isinstance(setting.get('options'), list):
        if for_write:
            raise ValueError('malformed select setting')
        return key, []
    options = setting['options']
    guids = set()
    clean = []
    for option in options:
        if not isinstance(option, dict) or not isinstance(option.get('guid'), str) or not option['guid']:
            if for_write:
                raise ValueError('malformed select option')
            continue
        if not isinstance(option.get('name'), str):
            if for_write:
                raise ValueError('malformed select option')
            continue
        if option['guid'] in guids:
            if for_write:
                raise ValueError('重复选项 GUID')
            continue
        guids.add(option['guid'])
        clean.append(option)
    return key, clean


def _complete_options(token, target, names):
    key, options = _select_options(target, for_write=True)
    # Legacy lists may already contain duplicate or hidden options. That makes those
    # specific values unsafe to write, but it must not fail the whole field (and with it
    # every sync). Keep the field usable; the write path still refuses ambiguous values.
    visible = [o for o in options if not o.get('is_hidden')]
    duplicated = [n for n in names if len([o for o in visible if o['name'] == n]) > 1]
    hidden_only = [n for n in names if not [o for o in visible if o['name'] == n]
                   and any(o.get('is_hidden') and o['name'] == n for o in options)]
    warnings = []
    if duplicated:
        warnings.append('同名可见选项重复，写入这些值会被拒绝：' + '、'.join(duplicated))
    if hidden_only:
        warnings.append('选项已隐藏，写入这些值会被拒绝：' + '、'.join(hidden_only))
    missing = [n for n in names if n not in {o['name'] for o in options}]
    if not missing:
        return target, [], warnings
    # Preserve GUIDs, hidden entries and all option metadata: PATCH replaces the full list.
    merged = [dict(o) for o in options] + [{'name': n} for n in missing]
    data = _api_data(call(token, '/task/v2/custom_fields/' + urllib.parse.quote(target['guid'], safe=''),
                          method='PATCH', body={'custom_field': {key: {**target[key], 'options': merged}},
                                               'update_fields': [key]}))
    after = data.get('custom_field')
    if not isinstance(after, dict) or after.get('guid') != target['guid'] or after.get('type') != target['type']:
        raise ValueError('追加选项回执缺失/不匹配')
    _, received = _select_options(after, for_write=True)
    by_guid = {o['guid']: o for o in received}
    if any(o['guid'] not in by_guid or by_guid[o['guid']].get('name') != o['name'] or
           bool(by_guid[o['guid']].get('is_hidden')) != bool(o.get('is_hidden')) for o in options):
        raise ValueError('追加选项回执未保留原 GUID/隐藏项')
    for n in missing:
        if len([o for o in received if o['name'] == n and not o.get('is_hidden')]) != 1:
            raise ValueError('追加选项后没拿到唯一 guid')
    return after, missing, warnings


def ensure_custom_field(token, action):
    result = {'op': 'ensure_custom_field', 'ok': False, 'created': False, 'guid': None,
              'name': action.get('name'), 'type': action.get('type', 'single_select'), 'error': None}
    posting = False
    try:
        name = _identifier(action.get('name'), 'name')
        kind = result['type']
        if kind not in SUPPORTED_FIELD_TYPES:
            raise ValueError('不支持字段类型 ' + str(kind))
        names = _option_names(action.get('options'))
        items = list_custom_fields(token, action.get('tasklist'))
        matches = [f for f in items if f['name'] == name]
        if len(matches) > 1:
            raise ValueError('字段重名，拒绝创建/写入')
        if matches:
            target = matches[0]
            result.update(guid=target['guid'], type=target['type'])
            if target['type'] != kind:
                raise ValueError(f'字段「{name}」已存在但类型是 {target["type"]}，不是 {kind}')
            added = []
            warnings = []
            if kind in ('single_select', 'multi_select'):
                target, added, warnings = _complete_options(token, target, names)
            result.update(ok=True, added=added)
            if warnings:
                result['warnings'] = warnings
            return result
        body = {'resource_type': 'tasklist', 'resource_id': action['tasklist'], 'name': name, 'type': kind}
        if kind in ('single_select', 'multi_select'):
            body[kind + '_setting'] = {'options': [{'name': n} for n in names]}
        elif kind == 'text':
            body['text_setting'] = {}
        else:
            body['datetime_setting'] = {'format': 'yyyy-mm-dd'}
        posting = True
        res = call(token, '/task/v2/custom_fields', method='POST', body=body)
        if isinstance(res, dict) and type(res.get('code')) is int and res['code'] != 0 and not 500 <= res['code'] <= 599:
            posting = False
        target = _api_data(res).get('custom_field')
        if not isinstance(target, dict) or not isinstance(target.get('guid'), str) or not target['guid'].strip() or target.get('name') != name or target.get('type') != kind:
            raise ValueError('字段创建回执缺失/不匹配')
        if kind in ('single_select', 'multi_select'):
            _, received = _select_options(target, for_write=True)
            if any(len([o for o in received if o['name'] == n and not o.get('is_hidden')]) != 1 for n in names):
                raise ValueError('字段创建回执未包含唯一选项 GUID')
        result.update(ok=True, created=True, guid=target['guid'])
    except Exception as exc:  # noqa: BLE001
        result['error'] = str(exc)[:200]
        if posting:
            result['unknownDelivery'] = True
    return result


def set_custom_field(token, action, failed_ensures=None):
    task = urllib.parse.quote(_identifier(action.get('task'), 'task'), safe='')
    if action.get('expected_type') is not None and action['expected_type'] not in SUPPORTED_FIELD_TYPES:
        raise ValueError('不支持 expected_type')
    target = _field_target(list_custom_fields(token, action.get('tasklist')), action)
    failure = (failed_ensures or {}).get((action.get('tasklist'), target['name']))
    if failure:
        return {'op': 'set_custom_field', 'ok': False, 'skipped': 'ensure_failed',
                'error': '同批 ensure 失败，跳过写入：' + failure}
    kind, raw = target['type'], action.get('value')
    value = {'guid': target['guid'], 'type': kind}
    if kind in ('single_select', 'multi_select'):
        if raw is None or raw == '' or raw == []:
            names = []
        elif kind == 'multi_select' and isinstance(raw, list):
            names = _option_names(raw)
        elif isinstance(raw, str):
            names = [raw]
        else:
            raise ValueError('select value 必须是字符串（多选可用字符串数组）')
        target, _, _ = _complete_options(token, target, names)
        _, options = _select_options(target, for_write=True)
        selected = []
        for name in names:
            matches = [o for o in options if o['name'] == name and not o.get('is_hidden')]
            if len(matches) != 1:
                raise ValueError('选项重名或隐藏，拒绝写入')
            selected.append(matches[0]['guid'])
        value[kind + '_value'] = (selected[0] if selected else '') if kind == 'single_select' else selected
    elif kind == 'datetime':
        import datetime as _dt
        if not isinstance(raw, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', raw):
            raise ValueError('日期字段要 YYYY-MM-DD')
        day = _dt.datetime.strptime(raw, '%Y-%m-%d').replace(tzinfo=_dt.timezone.utc)
        value['datetime_value'] = str(int(day.timestamp() * 1000))
    else:
        if raw is not None and not isinstance(raw, (str, int, float, bool)):
            raise ValueError('text value 必须是标量')
        value['text_value'] = '' if raw is None else str(raw)
    res = call(token, f'/task/v2/tasks/{task}?user_id_type=open_id', method='PATCH',
               body={'task': {'custom_fields': [value]}, 'update_fields': ['custom_fields']})
    ok = isinstance(res, dict) and res.get('code') == 0
    return {'op': 'set_custom_field', 'ok': ok, 'guid': target['guid'], 'type': kind,
            'error': None if ok else str(res.get('msg') or res.get('code'))[:200] if isinstance(res, dict) else 'malformed API response'}


def ensure_tasklist(token, action):
    """Resolve authoritatively before creating; never retry an ambiguous POST.

    Verified against official lark-oapi 1.7.5: CreateTasklistRequest uses POST
    /open-apis/task/v2/tasklists and user_id_type; InputTasklist declares name
    and client_token (not create_token). create_token is our bridge alias.
    """
    result = {'op': 'ensure_tasklist', 'ok': False, 'guid': action.get('guid'),
              'name': action.get('name'), 'created': False, 'error': None}
    posting = False
    try:
        guid = action.get('guid')
        if guid is not None:
            guid = _identifier(guid, 'guid')
            data = _api_data(call(token, '/task/v2/tasklists/' + urllib.parse.quote(guid, safe='') + '?user_id_type=open_id'))
            target = data.get('tasklist')
            if not isinstance(target, dict) or target.get('guid') != guid or not isinstance(target.get('name'), str) or not target['name']:
                raise ValueError('清单 GET 回执缺失/不匹配')
        else:
            name = _identifier(action.get('name'), 'name')
            token_value = action.get('create_token')
            if token_value is not None:
                _identifier(token_value, 'create_token')
            items = _list_all(token, '/task/v2/tasklists?user_id_type=open_id&page_size=100', 'tasklists')
            matches = [i for i in items if i['name'] == name]
            if len(matches) > 1:
                raise ValueError('清单重名，拒绝创建')
            if matches:
                target = matches[0]
            else:
                body = {'name': name}
                if token_value is not None:
                    body['client_token'] = token_value
                posting = True
                res = call(token, '/task/v2/tasklists?user_id_type=open_id', method='POST', body=body)
                if isinstance(res, dict) and type(res.get('code')) is int and res['code'] != 0 and not 500 <= res['code'] <= 599:
                    posting = False
                target = _api_data(res).get('tasklist')
                if not isinstance(target, dict) or not isinstance(target.get('guid'), str) or not target['guid'] or target.get('name') != name:
                    raise ValueError('清单创建回执缺失/不匹配')
                result['created'] = True
        result.update(ok=True, guid=target['guid'], name=target['name'])
    except Exception as exc:  # noqa: BLE001
        result['error'] = str(exc)[:200]
        if posting:
            result['unknownDelivery'] = True
    return result


def run_actions(token, actions):
    """CLI 没覆盖的写操作：任务挂清单、建文档目录、写文档、回写任务描述。"""
    results = []
    failed_ensures = {}
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
                key = (action.get('tasklist'), action.get('name'))
                if key in failed_ensures:
                    results.append({'op': op, 'ok': False, 'skipped': 'ensure_failed',
                                    'error': '同批 ensure 失败，跳过写入：' + failed_ensures[key]})
                else:
                    results.append(set_custom_field(token, action, failed_ensures))
            elif op == 'ensure_select_options':
                target = _field_target(list_custom_fields(token, action.get('tasklist')), action)
                if target['type'] not in ('single_select', 'multi_select'):
                    raise ValueError('不支持非 select 字段补选项')
                target, added, warnings = _complete_options(token, target, _option_names(action.get('options')))
                row = {'op': op, 'ok': True, 'guid': target['guid'], 'added': added, 'error': None}
                if warnings:
                    row['warnings'] = warnings
                results.append(row)
            elif op == 'ensure_custom_field':
                result = ensure_custom_field(token, action)
                results.append(result)
                if not result['ok']:
                    failed_ensures[(action.get('tasklist'), action.get('name'))] = result['error']
            elif op == 'ensure_tasklist':
                results.append(ensure_tasklist(token, action))
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
            elif op == 'task_reopen':
                # Same task-v2 PATCH envelope as set_task_time; reopening only clears completion.
                # Never interpolate a path/query or coerce another identifier into a task GUID.
                task_id = action.get('task')
                if not isinstance(task_id, str) or not re.fullmatch(
                        r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}', task_id):
                    raise ValueError('task 必须是完整任务 GUID')
                res = call(token, f'/task/v2/tasks/{task_id}?user_id_type=open_id',
                           method='PATCH', body={'task': {'completed_at': '0'},
                                                 'update_fields': ['completed_at']})
                ok = res.get('code') == 0
                results.append({'op': op, 'ok': ok,
                                'error': None if ok else str(res.get('msg') or res.get('code') or '任务重开失败')[:200]})
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
        try:
            items = list_custom_fields(token, list_guid)
        except Exception as exc:  # noqa: BLE001
            out['errors'].append(f'fields {list_guid}: {str(exc)[:200]}')
            continue
        out['fields'][list_guid] = [
            {
                'guid': item.get('guid'),
                'name': item.get('name'),
                'type': item.get('type'),
                'options': options_of(item),
            }
            for item in items
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
