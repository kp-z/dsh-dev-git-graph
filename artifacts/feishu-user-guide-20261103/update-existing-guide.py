from pathlib import Path
import hashlib
import json
import re

from feishu_sync.core import FeishuSync
from feishu_sync.api import __get_doc_content
from feishu_sync.api_write import convert_markdown_to_blocks, create_descendant_blocks, delete_blocks, _patch_table_blocks

ROOT = Path(__file__).resolve().parent
DOC = 'TrMvddkf2oCpmTxf14hcvfLrn6f'
URL = 'https://momenta.feishu.cn/docx/' + DOC
CHECKPOINT = ROOT / 'reorganization-write-checkpoint.json'
if CHECKPOINT.exists():
    raise RuntimeError('A write checkpoint already exists. Inspect it; never blindly repeat this update.')

markdown = (ROOT / 'reorganized-guide-publish.md').read_text()
baseline = (ROOT / 'reorganization-baseline.md').read_text()
paths = re.findall(r'!\[[^\]]*\]\(([^)]+)\)', markdown)
assert len(paths) == len(set(paths)) == 16
for path in paths:
    assert (ROOT / path).is_file()

fs = FeishuSync(token_provider=True)
fs.ensure_token()
current = fs.read_page_as_markdown(URL, force_refresh=True)
if current.strip() != baseline.strip():
    raise RuntimeError('Document changed after baseline capture; stop and rebase before editing.')
old = __get_doc_content(DOC)
old_map = {b['block_id']: b for b in old}
old_children = list(old_map[DOC]['children'])
assert len([b for b in old if isinstance(b.get('image'), dict)]) == 16
backup = ROOT / 'reorganization-old-blocks.json'
if backup.exists():
    raise RuntimeError('Old-block backup exists; inspect prior update before proceeding.')
backup.write_text(json.dumps(old, ensure_ascii=False, indent=2))

converted = convert_markdown_to_blocks(markdown)
_patch_table_blocks(converted['descendants'])
image_map = converted.get('block_id_to_image_urls') or []
assert len(image_map) == 16
print('Preflight passed. Appending validated replacement to the SAME document; original stays intact during upload.', flush=True)
created = create_descendant_blocks(DOC, DOC, converted['children_id'], converted['descendants'], index=len(old_children))
relations = {r['temporary_block_id']: r['block_id'] for r in created.get('block_id_relations') or []}
new_children = [relations[temp] for temp in converted['children_id']]
checkpoint = {'url': URL, 'phase': 'replacement_inserted', 'old_children': old_children, 'new_children': new_children}
CHECKPOINT.write_text(json.dumps(checkpoint, ensure_ascii=False, indent=2))
fs._upload_block_images(image_map, created, ROOT, markdown, DOC)

all_blocks = __get_doc_content(DOC)
block_map = {b['block_id']: b for b in all_blocks}
assert block_map[DOC]['children'] == old_children + new_children, 'Unexpected document structure; keep original and stop.'
checks = []
for mapping in image_map:
    bid = relations[mapping['block_id']]
    token = block_map[bid].get('image', {}).get('token')
    assert token, 'An uploaded image has no token; retain original and stop.'
    path = mapping['image_url']
    original_hash = hashlib.sha256((ROOT / path).read_bytes()).hexdigest()
    remote_path = Path(fs.get_image(token))
    remote_hash = hashlib.sha256(remote_path.read_bytes()).hexdigest()
    assert original_hash == remote_hash, 'Uploaded screenshot differs: ' + path
    checks.append({'path': path, 'remote_token': token, 'sha256': remote_hash, 'verified': True})

# The only remote deletion is the exact original content range in this user-requested document.
# Re-check root order and every original block to avoid deleting concurrent edits.
latest = __get_doc_content(DOC)
latest_map = {b['block_id']: b for b in latest}
assert latest_map[DOC]['children'] == old_children + new_children, 'Concurrent root edits detected; keep original and stop.'
for bid, block in old_map.items():
    if bid == DOC:
        continue
    assert latest_map.get(bid) == block, 'Original content changed during upload; stop before deleting.'
checkpoint.update(phase='replacement_and_images_verified', images=checks)
CHECKPOINT.write_text(json.dumps(checkpoint, ensure_ascii=False, indent=2))
print('All 16 uploaded images match original bytes. Replacing only the verified original body.', flush=True)
delete_blocks(DOC, DOC, 0, len(old_children))
checkpoint['phase'] = 'original_body_replaced'
CHECKPOINT.write_text(json.dumps(checkpoint, ensure_ascii=False, indent=2))

final_blocks = __get_doc_content(DOC)
final_map = {b['block_id']: b for b in final_blocks}
assert final_map[DOC]['children'] == new_children
assert len([b for b in final_blocks if isinstance(b.get('image'), dict)]) == 16
final = fs.read_page_as_markdown(URL, force_refresh=True)
assert len(re.findall(r'^## [1-6]\. ', final, re.M)) == 6
assert len(re.findall(r'image_token=', final)) == 16
assert '命令行安装' in final and 'Prompt 安装' in final
assert 'DSH 后台持续运行' in final and '评论协作' in final
(ROOT / 'reorganized-published-readback.md').write_text(final)
checkpoint['phase'] = 'verified_complete'
CHECKPOINT.write_text(json.dumps(checkpoint, ensure_ascii=False, indent=2))
print(json.dumps({'url': URL, 'status': 'verified_complete', 'chapters': 6, 'verified_original_images': 16}, ensure_ascii=False), flush=True)
