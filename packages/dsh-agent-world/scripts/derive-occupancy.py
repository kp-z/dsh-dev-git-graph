#!/usr/bin/env python3
"""从办公室家具层派生"美术占位格 + 小连通块整块矩形"（R230/R231）。

判据（与 `src/content/packs/office-occupancy.ts` 注释一致）：
1. 逐格统计 layer1..4 在**下半 60%** 的 alpha 覆盖率，>= 0.30 的格判为占位格；
2. 对这些格所在的 alpha 连通块（4 邻接）求外接矩形；
3. 只输出 <= 3×3 格（96×96 px）的小块矩形——大块（整排工位/墙带）会吞走道，宁可按格。

无第三方依赖（只用 zlib/struct 解 PNG）。输出可直接替换
`OFFICE_OCCUPANCY` / `OFFICE_OCCUPANCY_RECTS` 两个常量。

用法：python3 scripts/derive-occupancy.py
"""
import collections
import json
import os
import re
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCENE = os.path.join(ROOT, 'src/vendor/microverse/scene')
W, H, C = 37, 21, 32


def read_png(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    pos, idat = 8, b''
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + ln]
        pos += 12 + ln
        if typ == b'IHDR':
            w, h, _bit, ct, _c, _f, _i = struct.unpack('>IIBBBBB', chunk)
        elif typ == b'IDAT':
            idat += chunk
        elif typ == b'IEND':
            break
    raw = zlib.decompress(idat)
    ch = {0: 1, 2: 3, 4: 2, 6: 4}[ct]
    stride = w * ch
    out = bytearray(h * stride)
    prev = bytearray(stride)
    i = 0
    for y in range(h):
        f = raw[i]
        i += 1
        line = bytearray(raw[i:i + stride])
        i += stride
        for x in range(stride):
            a = line[x - ch] if x >= ch else 0
            b = prev[x]
            c = prev[x - ch] if x >= ch else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + b) & 255
            elif f == 3:
                line[x] = (line[x] + ((a + b) >> 1)) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, ch, out


def main():
    alpha = [0] * (W * H)
    for i in (1, 2, 3, 4):
        w, h, ch, px = read_png(os.path.join(SCENE, f'office-layer{i}.png'))
        for y in range(min(h, H * C)):
            for x in range(min(w, W * C)):
                a = px[(y * w + x) * ch + 3]
                if a > alpha[y * W * C + x] if False else False:
                    pass
    # 上面的二维索引太绕：直接按像素存一维 alpha（地图像素坐标）
    alpha = [0] * (W * C * H * C)
    layer_px = []
    for i in (1, 2, 3, 4):
        w, h, ch, px = read_png(os.path.join(SCENE, f'office-layer{i}.png'))
        layer_px.append((w, ch, px))
        for y in range(h):
            row = y * w
            for x in range(w):
                a = px[(row + x) * ch + 3]
                if a > alpha[y * w + x]:
                    alpha[y * w + x] = a

    def cov(col, row):
        # 与 R230 首次统计一致：逐层累加（不是先并集再算），避免把层间空白算成不透明。
        y0, y1 = int(row * C + 0.4 * C), int(row * C + C)
        total = hit = 0
        for (w, ch, px) in layer_px:
            for y in range(y0, y1):
                for x in range(col * C, col * C + C):
                    total += 1
                    if px[(y * w + x) * ch + 3] > 0:
                        hit += 1
        return hit / total

    # 只处理"原本可走"的格：已经 blocked 的格由墙/家具碰撞体负责，不重复占位。
    map_src = open(os.path.join(ROOT, 'src/content/packs/office-map.ts'), encoding='utf-8').read()
    walkable = json.loads(re.search(r'walkable:\s*(\[[\s\S]*?\]),', map_src, re.S).group(1))
    cells = [
        row * W + col
        for row in range(H)
        for col in range(W)
        if walkable[row * W + col] is True and cov(col, row) >= 0.30
    ]

    # 连通块
    seen = bytearray(W * C * H * C)
    comps = []
    for start in range(W * C * H * C):
        if alpha[start] <= 8 or seen[start]:
            continue
        q = collections.deque([start])
        seen[start] = 1
        minx = maxx = start % (W * C)
        miny = maxy = start // (W * C)
        n = 0
        while q:
            p = q.popleft()
            x, y = p % (W * C), p // (W * C)
            n += 1
            minx, maxx = min(minx, x), max(maxx, x)
            miny, maxy = min(miny, y), max(maxy, y)
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < W * C and 0 <= ny < H * C:
                    np = ny * (W * C) + nx
                    if alpha[np] > 8 and not seen[np]:
                        seen[np] = 1
                        q.append(np)
        if n >= 40:
            comps.append((minx, miny, maxx - minx + 1, maxy - miny + 1))

    rects = []
    for pos in cells:
        col, row = pos % W, pos // W
        cx, cy = col * C + C // 2, row * C + C // 2
        for (x, y, w, h) in comps:
            if x <= cx < x + w and y <= cy < y + h:
                if w <= 3 * C and h <= 3 * C and (x, y, w, h) not in rects:
                    rects.append((x, y, w, h))
                break

    print('OFFICE_OCCUPANCY =', cells)
    print('OFFICE_OCCUPANCY_RECTS =', rects)


if __name__ == '__main__':
    main()
