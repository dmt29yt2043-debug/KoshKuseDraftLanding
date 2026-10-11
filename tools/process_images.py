"""Подготовка фото для сайта KOSH KUSÉ.

Берёт оригиналы из «Сайт/Картинки», тонирует чёрно-белые кадры в тёплый монохром
по палитре бренда (эбен → тауп → слоновая кость), режет под нужное соотношение
с фокусной точкой и сохраняет WebP в двух ширинах для srcset.

Использование: python3 process_images.py selection.json out_dir
selection.json: [{"id": "img46.jpg", "name": "hero", "tone": "warm|natural",
                  "aspect": 0.5625 | null, "focus": [0.5, 0.4], "widths": [720, 1200]}]
"""
import json
import os
import sys
import unicodedata

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = '/Users/maxsnigirev/Claude Code/Kosh-Kuse-Finance'

# тёплый монохром: тени — эбен, полутона — шарколь/тауп, света — слоновая кость
STOPS = [
    (0.00, (0x1C, 0x19, 0x16)),
    (0.30, (0x3F, 0x38, 0x31)),
    (0.62, (0x9C, 0x8F, 0x7D)),
    (0.86, (0xDD, 0xD3, 0xC1)),
    (1.00, (0xF7, 0xF3, 0xE8)),
]


def build_lut():
    xs = np.linspace(0, 1, 256)
    lut = np.zeros((256, 3), dtype=np.float32)
    for c in range(3):
        lut[:, c] = np.interp(xs, [s[0] for s in STOPS], [s[1][c] for s in STOPS])
    return lut.astype(np.uint8)


LUT = build_lut()


def source_dir():
    for d in os.listdir(PROJECT):
        p = os.path.join(PROJECT, d)
        if os.path.isdir(p) and d != 'backups' and os.path.isdir(os.path.join(p, 'Картинки')):
            return os.path.join(p, 'Картинки')
        if os.path.isdir(p):
            for sub in os.listdir(p):
                if unicodedata.normalize('NFC', sub) == 'Картинки':
                    return os.path.join(p, sub)
    raise SystemExit('не нашёл папку с картинками')


def warm(im):
    g = np.asarray(im.convert('L'))
    return Image.fromarray(LUT[g], 'RGB')


def crop_aspect(im, aspect, focus):
    """aspect = ширина/высота; focus = (fx, fy) доли — куда сдвигать окно."""
    w, h = im.size
    if aspect is None:
        return im
    if w / h > aspect:                       # слишком широкая — режем по ширине
        nw = int(round(h * aspect))
        x0 = int(round((w - nw) * focus[0]))
        return im.crop((x0, 0, x0 + nw, h))
    nh = int(round(w / aspect))              # слишком высокая — режем по высоте
    y0 = int(round((h - nh) * focus[1]))
    return im.crop((0, y0, w, y0 + nh))


def main():
    sel = json.load(open(sys.argv[1]))
    out = sys.argv[2]
    os.makedirs(out, exist_ok=True)
    cat = {c['id']: c['file'] for c in json.load(open(os.path.join(HERE, 'catalog_raw.json')))}
    src = source_dir()
    names = {unicodedata.normalize('NFC', n): n for n in os.listdir(src)}
    total = 0
    for s in sel:
        if s['id'].startswith('brand:'):
            path = os.path.join(HERE, 'brand', s['id'][6:] + '.png')
        elif s['id'].startswith('gen:'):
            path = os.path.join(os.path.dirname(src), 'Сгенерировано', s['id'][4:] + '.png')
        else:
            path = os.path.join(src, names[unicodedata.normalize('NFC', cat[s['id']])])
        im = Image.open(path).convert('RGB')
        if s.get('box'):
            W, H = im.size
            x0, y0, x1, y1 = s['box']
            im = im.crop((int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H)))
        im = crop_aspect(im, s.get('aspect'), s.get('focus', [0.5, 0.5]))
        if s.get('tone', 'warm') == 'warm':
            im = warm(im)
        for wd in s.get('widths', [720, 1200]):
            v = im if im.width <= wd else im.resize((wd, int(round(im.height * wd / im.width))), Image.LANCZOS)
            fn = os.path.join(out, f"{s['name']}-{wd}.webp")
            v.save(fn, 'WEBP', quality=s.get('q', 78), method=6)
            total += os.path.getsize(fn)
            print(f"{s['name']:14} {wd:>5}w → {v.size[0]}×{v.size[1]}  {os.path.getsize(fn) // 1024:>4} КБ")
    print(f'итого: {total / 1024 / 1024:.2f} МБ')


if __name__ == '__main__':
    main()
