#!/usr/bin/env python3
"""
把 `OFFICE_MAP` 的**图块层 + 对象层**一起烘成 `src/vendor/microverse/scene/office.png`。

## 为什么需要这个脚本

`office.png` 原来是**一次性产物**：它只烘了图块层（WallAndFloor / Furniture0-4），
而椅子在原版场景里是 **prefab 对象**（`FrontChair.tscn` / `BackChair.tscn` / `Chair.tscn`），
不是图块 —— 所以桌子前面一直没有椅子。而且那份 PNG 与碰撞网格分别生成，
两边一旦不同步，就会出现"墙贴和碰撞不匹配"。

现在把两者放进**同一次生成**：看到的图和数据来自同一次烘焙，以后改场景只要重跑本脚本。

## 用法

```sh
python3 scripts/bake-office-map.py
```

依赖：`Pillow`。图块图集来自本仓库 `src/vendor/microverse/maps/`，
椅子贴图来自 `src/vendor/microverse/single-objects/`（已随仓库提交，脚本不依赖外部仓库）。

## 坐标

原版地图 37×21 格、一格 32px。图块单元的 `atlas_x/atlas_y` 是 32px 单位；
对象 `px` 是**地图绝对像素**，`Sprite2D.position` 是相对节点原点的偏移（Godot 默认居中）。
"""
import json
import os
import re
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAP_TS = os.path.join(ROOT, 'src/content/packs/office-map.ts')
MAPS_DIR = os.path.join(ROOT, 'src/vendor/microverse/maps')
SINGLES_DIR = os.path.join(ROOT, 'src/vendor/microverse/single-objects')
SCENE_DIR = os.path.join(ROOT, 'src/vendor/microverse/scene')
OUT = os.path.join(SCENE_DIR, 'office.png')
COLLIDERS_OUT = os.path.join(ROOT, 'src/vendor/microverse/scene/office-colliders.json')
OBJECTS_OUT = os.path.join(ROOT, 'src/vendor/microverse/scene/office-objects.json')
WALLS_OUT = os.path.join(ROOT, 'src/vendor/microverse/scene/office-walls.png')
TILES_OUT = os.path.join(ROOT, 'src/vendor/microverse/scene/office-tiles.json')

# 椅子 prefab → （贴图, Sprite2D 相对偏移）。偏移取自原版 .tscn 的 `position = Vector2(...)`，
# 缺省即居中于节点原点。
CHAIR_PREFABS = {
    'FrontChair.tscn': ('office-chair-101.png', (16, -24)),
    'BackChair.tscn': ('office-chair-106.png', (16, -24)),
    'Chair.tscn': ('office-chair-110.png', (0, 0)),
}


def load_map() -> dict:
    """从生成物 TS 里抠出 `width/height/cellPx/layers/objects`（都是 JSON 字面量）。"""
    src = open(MAP_TS, encoding='utf-8').read()

    def grab(pattern: str):
        m = re.search(pattern, src, re.S)
        if m is None:
            raise SystemExit(f'在 {MAP_TS} 里找不到 {pattern}')
        return json.loads(m.group(1))

    return {
        'width': grab(r'width: (\d+)'),
        'height': grab(r'height: (\d+)'),
        'cellPx': grab(r'cellPx: (\d+)'),
        'layers': grab(r'layers: (\[[\s\S]*?\]),\n  rooms:'),
        'objects': grab(r'objects: (\[[\s\S]*?\]),\n  /\*\* 房间的格矩形'),
    }


def main() -> int:
    m = load_map()
    W, H, C = m['width'], m['height'], m['cellPx']
    canvas = Image.new('RGBA', (W * C, H * C), (0, 0, 0, 0))

    atlases: dict[str, Image.Image] = {}
    painted = 0
    for layer in m['layers']:
        for x, y, atlas_index, ax, ay in layer['cells']:
            name = layer['atlasFiles'][atlas_index]
            path = os.path.join(MAPS_DIR, name)
            if not os.path.exists(path):
                raise SystemExit(f'缺图集：{path}')
            if name not in atlases:
                atlases[name] = Image.open(path).convert('RGBA')
            tile = atlases[name].crop((ax * C, ay * C, ax * C + C, ay * C + C))
            canvas.alpha_composite(tile, (x * C, y * C))
            painted += 1

    # 对象层（椅子）**不进底图**：底图是一整张 depth=-1 的图，烘进去就永远压在角色下面。
    # 原版里椅子是独立节点、和角色一起做 Y 排序 —— 所以这里只导出**数据**，
    # 由前端渲染成实体（见 `office-objects.json`）。
    chairs = [o for o in m['objects'] if o['prefab'] in CHAIR_PREFABS]
    chairs.sort(key=lambda o: (o['px'][1], o['px'][0]))

    canvas.save(OUT)
    print(f'已烘焙 {OUT}')
    print(f'  尺寸 {W * C}×{H * C}，图块 {painted} 格，椅子 {len(chairs)} 把')

    objects_out = {
        'chairs': [
            {
                'texture': CHAIR_PREFABS[o['prefab']][0],
                # **父节点名**：原版里椅子分组穿插在家具层之间（ReceptionChair 在 Furniture0 之下、
                # BackChairs 在所有家具之上）。丢掉这个信息就只能把椅子全塞进同一层 ——
                # 表现就是"椅子盖在桌子上"。
                'parent': o.get('parent', ''),
                'px': [o['px'][0] + CHAIR_PREFABS[o['prefab']][1][0],
                       o['px'][1] + CHAIR_PREFABS[o['prefab']][1][1]],
            }
            for o in chairs
        ],
    }
    with open(OBJECTS_OUT, 'w', encoding='utf-8') as fh:
        json.dump(objects_out, fh, ensure_ascii=False, separators=(',', ':'))
    print(f'  对象 {len(objects_out["chairs"])} 个（椅子，运行时按 y 排序）→ {OBJECTS_OUT}')

    colliders = build_colliders(m, atlases, C)

    # 墙体单独出一张透明图 + 逐行合并的矩形：前端按矩形 `setCrop` 贴上去、按**行底部**取深度。
    # 为什么必须拆：整张底图是 depth=-1 的一张图，角色永远压在墙上；
    # 原版 Godot 里墙和角色同在 Y 排序层 —— 走到墙**上方**应该被墙挡住。
    # ── 按**原版的层**各自导出 PNG ───────────────────────────────────────────
    # 原版 Office.tscn 里没有一处 `y_sort_enabled`，层序是固定的：
    #   z_index 0（按节点顺序）：WallAndFloor → Furniture0 → Furniture1 → Furniture2
    #                            → Furniture3 → 椅子对象 → Characters
    #   z_index 1：Furniture4（画在所有角色之上 —— 墙上的挂件/黑板就在这一层）
    # 所以这里把每个 TileMapLayer 单独烘一张，前端按层序摆即可；不要自己发明 Y 排序。
    for layer_index, layer in enumerate(m['layers']):
        layer_img = Image.new('RGBA', (W * C, H * C), (0, 0, 0, 0))
        for x, y, atlas_index, ax, ay in layer['cells']:
            name = layer['atlasFiles'][atlas_index]
            tile = atlases[name].crop((ax * C, ay * C, ax * C + C, ay * C + C))
            layer_img.alpha_composite(tile, (x * C, y * C))
        layer_img.save(os.path.join(SCENE_DIR, f'office-layer{layer_index}.png'))
    print(f'  分层图 {len(m["layers"])} 张 → office-layer0..{len(m["layers"]) - 1}.png')

    # ── 可 Y 排序的"对象矩形" ─────────────────────────────────────────────────
    # 为什么要把家具从"整层一张图"拆成矩形：整层图只有一个深度，角色永远压在它上面；
    # 拆成"每行一个矩形 + 深度取该行底边"之后，角色站到桌子**后面**才会被挡住。
    # 地板**不参与**（地板一旦排序，角色会被脚下的地板盖住）—— 它留在整层图里当背景。
    tile_rects = []
    last_index = len(m['layers']) - 1
    for layer_index, layer in enumerate(m['layers']):
        if layer_index == 0:
            continue  # WallAndFloor 里的墙由 `walls` 单独处理，地板留背景
        if layer_index == last_index:
            # Furniture4 在原版带 `z_index = 1`：**固定在角色之上**，不参与排序。
            # 把它也放进矩形列表会导致同一像素画两遍（一次排序、一次置顶）。
            continue
        cell_set = {(c[0], c[1]) for c in layer['cells']}
        for row in range(H):
            col = 0
            while col < W:
                if (col, row) not in cell_set:
                    col += 1
                    continue
                start = col
                while col < W and (col, row) in cell_set:
                    col += 1
                tile_rects.append({'layer': layer_index, 'rect': [start * C, row * C, (col - start) * C, C]})
    with open(TILES_OUT, 'w', encoding='utf-8') as fh:
        json.dump({'rects': tile_rects}, fh, ensure_ascii=False, separators=(',', ':'))
    print(f'  可排序家具矩形 {len(tile_rects)} 个 → {TILES_OUT}')

    walls_img = Image.new('RGBA', (W * C, H * C), (0, 0, 0, 0))
    wall_rects = []
    for row in range(H):
        col = 0
        while col < W:
            if not is_wall_cell(m, col, row):
                col += 1
                continue
            start = col
            while col < W and is_wall_cell(m, col, row):
                col += 1
            wall_rects.append([start * C, row * C, (col - start) * C, C])
    # 从已烘好的整图里把墙格抠出来（像素一致，不会因为二次绘制出现色差）
    canvas_rgba = canvas.convert('RGBA')
    for x, y, w, h in wall_rects:
        walls_img.paste(canvas_rgba.crop((x, y, x + w, y + h)), (x, y))
    walls_img.save(WALLS_OUT)
    colliders['walls'] = wall_rects
    print(f'  墙体 {len(wall_rects)} 条 → {WALLS_OUT}')
    with open(COLLIDERS_OUT, 'w', encoding='utf-8') as fh:
        json.dump(colliders, fh, ensure_ascii=False, separators=(',', ':'))
    print(f'  碰撞体 {len(colliders["rects"])} 个'
          f'（家具 {colliders["counts"]["furniture"]} / 墙 {colliders["counts"]["wall"]}）'
          f' → {COLLIDERS_OUT}')
    return 0


def is_wall_cell(m: dict, col: int, row: int) -> bool:
    """这一格是不是**墙**：被标为阻挡、且没有任何家具层瓦片（家具另算）。"""
    W = m['width']
    src = open(MAP_TS, encoding='utf-8').read()
    wk = json.loads(re.search(r'walkable: (\[[\s\S]*?\]),', src, re.S).group(1))
    if wk[row * W + col] == True:
        return False
    for layer_index, layer in enumerate(m['layers']):
        if layer_index == 0:
            continue
        for x, y in [(c[0], c[1]) for c in layer['cells']]:
            if x == col and y == row:
                return False
    return True


def build_colliders(m: dict, atlases: dict, C: int) -> dict:
    """按**美术实际轮廓**生成碰撞矩形（地图像素坐标）。

    为什么不能直接用格子：一格的实心标记是 32×32，而格子里的家具往往只占一半 ——
    整格当实心会让人离桌子/墙老远就被挡住（这就是"墙贴不匹配"的观感来源）。

    做法：
    · 有家具瓦片的格子 → 取该格所有家具瓦片 alpha 的并集包围盒（真实足印）；
    · 没有家具瓦片的格子（墙体）→ 保留整格（墙本来就是实心的，也不该贴着走）。
    """
    import numpy as np

    W, H = m['width'], m['height']
    walkable_src = open(MAP_TS, encoding='utf-8').read()
    wk = json.loads(re.search(r'walkable: (\[[\s\S]*?\]),', walkable_src, re.S).group(1))

    # 每格都有哪些家具层的瓦片
    furniture_at = {}
    for layer_index, layer in enumerate(m['layers']):
        if layer_index == 0:
            continue  # 0 = WallAndFloor（地板/墙），不参与"家具足印"
        for x, y, atlas_index, ax, ay in layer['cells']:
            furniture_at.setdefault((x, y), []).append((layer['atlasFiles'][atlas_index], ax, ay))

    # 瓦片 alpha 包围盒缓存
    alpha_bbox = {}

    def bbox_of(name, ax, ay):
        key = (name, ax, ay)
        if key in alpha_bbox:
            return alpha_bbox[key]
        atlas = atlases[name]
        tile = atlas.crop((ax * C, ay * C, ax * C + C, ay * C + C))
        alpha = np.asarray(tile.split()[-1])
        ys, xs = np.nonzero(alpha > 8)
        box = None if len(xs) == 0 else (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
        alpha_bbox[key] = box
        return box

    rects = []
    counts = {'furniture': 0, 'wall': 0}
    for row in range(H):
        col = 0
        while col < W:
            blocked = wk[row * W + col] != True
            if not blocked:
                col += 1
                continue
            tiles = furniture_at.get((col, row))
            if not tiles:
                # 墙：整格（同一行连续的墙合并成一条）
                start = col
                while col < W and wk[row * W + col] != True and furniture_at.get((col, row)) is None:
                    col += 1
                w = (col - start) * C
                rects.append([start * C, row * C, w, C])
                counts['wall'] += 1
                continue
            # 家具：把该格所有家具瓦片的 alpha 包围盒并起来
            x0 = y0 = C
            x1 = y1 = 0
            for name, ax, ay in tiles:
                box = bbox_of(name, ax, ay)
                if box is None:
                    continue
                x0, y0 = min(x0, box[0]), min(y0, box[1])
                x1, y1 = max(x1, box[2]), max(y1, box[3])
            if x1 <= x0 or y1 <= y0:
                # 家具瓦片其实全透明（装饰件）：整格，保守一点
                rects.append([col * C, row * C, C, C])
            else:
                rects.append([col * C + x0, row * C + y0, x1 - x0, y1 - y0])
            counts['furniture'] += 1
            col += 1
    return {'cellPx': C, 'width': W, 'height': H, 'rects': rects, 'counts': counts}


if __name__ == '__main__':
    sys.exit(main())
