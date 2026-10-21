#!/usr/bin/env python3
"""从 `office-map.ts` 还原**真正的 Tiled 图块地图**（R235）。

为什么：Tiled 的对象层只能画矩形/多边形，不能显示任意图片。想看到"实体"，
必须用 **tileset + tile layer**；对象层只放碰撞/站点/椅子这类覆盖物。

输出：
  tools/tilesets/<atlas>.tsx     每个图集一个 tileset
  tools/tilesets/chairs.png/.tsx 3 张椅子合成的小图集
  tools/office-tilemap.tmx       5 个图块层 + colliders/chairs/stations 对象层
"""
import json, os, re, struct, urllib.request, zlib
from xml.sax.saxutils import escape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAP_TS = os.path.join(ROOT, 'src/content/packs/office-map.ts')
MAPS = os.path.join(ROOT, 'src/vendor/microverse/maps')
SINGLE = os.path.join(ROOT, 'src/vendor/microverse/single-objects')
SCENE = os.path.join(ROOT, 'src/vendor/microverse/scene')
TOOLS = os.path.join(ROOT, 'tools')

def read_png(path):
    data = open(path, 'rb').read()
    pos, idat = 8, b''
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos+4])[0]
        typ = data[pos+4:pos+8]
        chunk = data[pos+8:pos+8+ln]
        pos += 12 + ln
        if typ == b'IHDR':
            w, h, _b, ct, _c, _f, _i = struct.unpack('>IIBBBBB', chunk)
        elif typ == b'IDAT':
            idat += chunk
        elif typ == b'IEND':
            break
    raw = zlib.decompress(idat)
    ch = {0:1, 2:3, 4:2, 6:4}[ct]
    stride = w * ch
    out = bytearray(h * stride)
    prev = bytearray(stride)
    i = 0
    for y in range(h):
        f = raw[i]; i += 1
        line = bytearray(raw[i:i+stride]); i += stride
        for x in range(stride):
            a = line[x-ch] if x >= ch else 0
            b = prev[x]
            c = prev[x-ch] if x >= ch else 0
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + ((a + b) >> 1)) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p-a), abs(p-b), abs(p-c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        out[y*stride:(y+1)*stride] = line
        prev = line
    return w, h, ch, out

def write_png(path, w, h, rgba):
    raw = b''.join(b'\x00' + bytes(rgba[y*w*4:(y+1)*w*4]) for y in range(h))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(png)

def dims(path):
    d = open(path, 'rb').read(24)
    return struct.unpack('>II', d[16:24])

def grap(src, pattern):
    return json.loads(re.search(pattern, src, re.S).group(1))

def chair_atlas(chairs):
    unique = []
    for c in chairs:
        if c['texture'] not in unique:
            unique.append(c['texture'])
    w, h = 64, 96
    W, H = w * len(unique), h
    canvas = bytearray(W * H * 4)
    for i, name in enumerate(unique):
        iw, ih, ch, px = read_png(os.path.join(SINGLE, name))
        for y in range(min(ih, h)):
            for x in range(min(iw, w)):
                o = (y * iw + x) * ch
                d = (y * W + i * w + x) * 4
                canvas[d:d+4] = px[o:o+4] if ch == 4 else bytes([px[o], px[o+1], px[o+2], 255])
    os.makedirs(os.path.join(TOOLS, 'tilesets'), exist_ok=True)
    write_png(os.path.join(TOOLS, 'tilesets', 'chairs.png'), W, H, canvas)
    tsx = f'''<?xml version="1.0" encoding="UTF-8"?>
<tileset version="1.10" tiledversion="1.12.2" name="chairs" tilewidth="64" tileheight="96" tilecount="{len(unique)}" columns="{len(unique)}">
 <image source="chairs.png" width="{W}" height="{H}"/>
</tileset>
'''
    open(os.path.join(TOOLS, 'tilesets', 'chairs.tsx'), 'w', encoding='utf-8').write(tsx)
    return unique

def main():
    src = open(MAP_TS, encoding='utf-8').read()
    layers = grap(src, r'layers: (\[[\s\S]*?\]),\n  rooms:')
    objects = grap(src, r'objects: (\[[\s\S]*?\]),\n  /\*\* 房间的格矩形')
    W, H, C = 37, 21, 32
    os.makedirs(os.path.join(TOOLS, 'tilesets'), exist_ok=True)

    # 图集 → 列数/firstgid
    atlases = {}
    for layer in layers:
        for name in layer['atlasFiles']:
            if name in atlases: continue
            w, h = dims(os.path.join(MAPS, name))
            cols = w // C
            atlases[name] = {'columns': cols, 'tilecount': cols * (h // C), 'w': w, 'h': h}
    gid = 1
    for name, a in atlases.items():
        a['firstgid'] = gid
        gid += a['tilecount']
        tsx = f'''<?xml version="1.0" encoding="UTF-8"?>
<tileset version="1.10" tiledversion="1.12.2" name="{escape(name[:-4])}" tilewidth="{C}" tileheight="{C}" tilecount="{a['tilecount']}" columns="{a['columns']}">
 <image source="../../src/vendor/microverse/maps/{escape(name)}" width="{a['w']}" height="{a['h']}"/>
</tileset>
'''
        open(os.path.join(TOOLS, 'tilesets', name.replace('.png', '.tsx')), 'w', encoding='utf-8').write(tsx)

    chair_tex = {'FrontChair.tscn': 'office-chair-101.png', 'BackChair.tscn': 'office-chair-106.png', 'Chair.tscn': 'office-chair-110.png'}
    chairs = [dict(o, texture=chair_tex[o['prefab']]) for o in objects if o.get('prefab') in chair_tex]
    chair_names = chair_atlas(chairs)
    chair_first = gid

    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           f'<map version="1.10" tiledversion="1.12.2" orientation="orthogonal" renderorder="right-down" width="{W}" height="{H}" tilewidth="{C}" tileheight="{C}" infinite="0" nextlayerid="{len(layers)+4}" nextobjectid="1000">']
    for name, a in atlases.items():
        out.append(f' <tileset firstgid="{a["firstgid"]}" source="tilesets/{escape(name.replace(".png", ".tsx"))}"/>')
    out.append(f' <tileset firstgid="{chair_first}" source="tilesets/chairs.tsx"/>')

    for layer in layers:
        grid = [0] * (W * H)
        for x, y, ai, ax, ay in layer['cells']:
            if not (0 <= x < W and 0 <= y < H): continue
            name = layer['atlasFiles'][ai]
            a = atlases[name]
            tid = ay * a['columns'] + ax
            if tid >= a['tilecount']: continue
            grid[y * W + x] = a['firstgid'] + tid
        out.append(f' <layer id="{len(out)}" name="{escape(layer["name"])}" width="{W}" height="{H}">')
        out.append('  <data encoding="csv">')
        for y in range(H):
            out.append(','.join(str(v) for v in grid[y*W:(y+1)*W]) + (',' if y < H - 1 else ''))
        out.append('  </data>')
        out.append(' </layer>')

    # 碰撞层
    coll = None
    for path in (os.path.join(SCENE, 'office-colliders-override.json'), os.path.join(SCENE, 'office-colliders.json')):
        if os.path.exists(path):
            coll = json.load(open(path))['rects']
            break
    out.append(f' <objectgroup id="{len(out)}" name="colliders">')
    for i, (x, y, w, h) in enumerate(coll or [], 1):
        out.append(f'  <object id="{i}" x="{x}" y="{y}" width="{w}" height="{h}"/>')
    out.append(' </objectgroup>')

    # 椅子：tile object（真正的图）
    out.append(f' <objectgroup id="{len(out)}" name="chairs">')
    oid = 1
    for o in chairs:
        if o['texture'] not in chair_names: continue
        px = o['px']
        g = chair_first + chair_names.index(o['texture'])
        out.append(f'  <object id="{oid}" gid="{g}" x="{px[0]-32}" y="{px[1]+48}" width="64" height="96"/>')
        oid += 1
    out.append(' </objectgroup>')

    # 站点标记
    try:
        world = json.load(urllib.request.urlopen('http://127.0.0.1:3080/agent-world/api/world', timeout=3))['world']
        nav = world['nav']
        out.append(f' <objectgroup id="{len(out)}" name="stations">')
        for st in world['stations']:
            x = (st['anchor']['x'] - nav['originX']) * 16 - 8
            y = (st['anchor']['z'] - nav['originZ']) * 16 - 8
            out.append(f'  <object id="{oid}" name="station:{escape(st["id"])}" x="{x}" y="{y}" width="16" height="16"/>')
            oid += 1
        out.append(' </objectgroup>')
    except Exception:
        pass

    out.append('</map>')
    open(os.path.join(TOOLS, 'office-tilemap.tmx'), 'w', encoding='utf-8').write('\n'.join(out) + '\n')
    print('✓ tools/office-tilemap.tmx', 'atlases', len(atlases), 'chairs', len(chairs), 'layers', len(layers))

if __name__ == '__main__':
    main()
