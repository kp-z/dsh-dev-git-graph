#!/usr/bin/env python3
"""把办公室场景的**每个元素**写成 Tiled 对象（R234）。

输出 `tools/office-scene.tmx`：
- `reference`：半透明底图，仅用于对位（不参与运行时）；
- `sortable`：家具 tile 矩形 + 墙矩形 + 椅子 + 站点标记；
- `above`：layer5（永远在角色之上）的整块占位。

每个对象带自定义属性：
  id / kind / texture / sx,sy,sw,sh / sort / depthBias
运行时按 id 读回 `sort` 与 `depthBias`（见 `web/scene/scene-phaser.js` 的 objectOverrides）。
"""
import json, os, struct, urllib.request
from xml.sax.saxutils import quoteattr

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCENE = os.path.join(ROOT, 'src/vendor/microverse/scene')
SINGLE = os.path.join(ROOT, 'src/vendor/microverse/single-objects')
OUT = os.path.join(ROOT, 'tools/office-scene.tmx')

def dims(path):
    d = open(path, 'rb').read(24)
    return struct.unpack('>II', d[16:24])

def props(obj):
    lines = ['   <properties>']
    for k, v in obj.items():
        if isinstance(v, (int, float)):
            lines.append(f'    <property name="{k}" type="float" value="{v}"/>')
        else:
            lines.append(f'    <property name="{k}" value={quoteattr(str(v))}/>')
    lines.append('   </properties>')
    return '\n'.join(lines)

def main():
    tiles = json.load(open(os.path.join(SCENE, 'office-tiles.json')))['rects']
    coll = json.load(open(os.path.join(SCENE, 'office-colliders.json')))
    chairs = json.load(open(os.path.join(SCENE, 'office-objects.json')))['chairs']
    try:
        world = json.load(urllib.request.urlopen('http://127.0.0.1:3080/agent-world/api/world', timeout=3))['world']
        stations = world['stations']
        nav = world['nav']
        origin = (nav['originX'], nav['originZ'])
    except Exception:
        stations, origin = [], (-37, -21)

    objects = []
    oid = 1
    def add(layer, name, x, y, w, h, extra):
        nonlocal oid
        objects.append((layer, oid, name, x, y, w, h, extra))
        oid += 1

    for i, item in enumerate(tiles):
        rx, ry, rw, rh = item['rect']
        add('sortable', f'tile:{i}', rx, ry, rw, rh, {
            'id': f'tile:{i}', 'kind': 'tile', 'texture': f"office-layer{item['layer']}.png",
            'sx': rx, 'sy': ry, 'sw': rw, 'sh': rh, 'sort': 'sortable', 'depthBias': 0,
        })
    for i, (rx, ry, rw, rh) in enumerate(coll.get('walls', [])):
        add('sortable', f'wall:{i}', rx, ry, rw, rh, {
            'id': f'wall:{i}', 'kind': 'wall', 'texture': 'office-walls.png',
            'sx': rx, 'sy': ry, 'sw': rw, 'sh': rh, 'sort': 'sortable', 'depthBias': 0,
        })
    for i, chair in enumerate(chairs):
        px = chair.get('px') or [0, 0]
        tw, th = dims(os.path.join(SINGLE, chair['texture']))
        add('sortable', f'chair:{i}', px[0] - tw / 2, px[1] - th / 2, tw, th, {
            'id': f'chair:{i}', 'kind': 'chair', 'texture': chair['texture'],
            'sort': 'sortable', 'depthBias': -8,
        })
    for st in stations:
        ax, az = st['anchor']['x'], st['anchor']['z']
        x = (ax - origin[0]) * 16 - 8
        y = (az - origin[1]) * 16 - 8
        add('stations', f"station:{st['id']}", x, y, 16, 16, {
            'id': f"station:{st['id']}", 'kind': 'station', 'texture': '',
            'sort': 'sortable', 'depthBias': 0,
        })
    add('above', 'above:full', 0, 0, 1184, 672, {
        'id': 'above:full', 'kind': 'above', 'texture': 'office-layer5.png',
        'sort': 'above', 'depthBias': 0,
    })

    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<map version="1.10" tiledversion="1.12.2" orientation="orthogonal" renderorder="right-down" width="37" height="21" tilewidth="32" tileheight="32" infinite="0" nextlayerid="5" nextobjectid="%d">' % (oid + 1),
           ' <imagelayer id="1" name="reference" opacity="0.35">',
           '  <image source="../src/vendor/microverse/scene/office.png" width="1184" height="672"/>',
           ' </imagelayer>']
    for layer in ('sortable', 'stations', 'above'):
        out.append(f' <objectgroup id="{2 + ("sortable stations above".split().index(layer))}" name="{layer}">')
        for (lay, i, name, x, y, w, h, extra) in objects:
            if lay != layer: continue
            out.append(f'  <object id="{i}" name="{name}" x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}">')
            out.append(props(extra))
            out.append('  </object>')
        out.append(' </objectgroup>')
    out.append('</map>')
    open(OUT, 'w', encoding='utf-8').write('\n'.join(out) + '\n')
    print(f'✓ {OUT}: {len(objects)} objects')

if __name__ == '__main__':
    main()
