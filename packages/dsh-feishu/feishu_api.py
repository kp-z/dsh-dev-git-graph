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
            elif op == 'set_custom_field':
                fields = call(token, f"/task/v2/custom_fields?resource_type=tasklist&resource_id={action['tasklist']}&page_size=50")
                items = ((fields.get('data') or {}).get('items') or [])
                target = next((f for f in items if f.get('name') == action['name']), None)
                if not target:
                    results.append({'op': op, 'ok': False, 'error': f"没有名为 {action['name']} 的字段"})
                    continue
                res = call(token, f"/task/v2/tasks/{action['task']}?user_id_type=open_id", method='PATCH',
                           body={'task': {'custom_fields': [{'guid': target['guid'], 'type': target['type'],
                                                             'text_value': action['value']}]},
                                 'update_fields': ['custom_fields']})
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
