"""Векторизация логотипа KOSH KUSÉ из растрового брендборда.

Карта альфы (кремовый на бордо) → увеличение → порог → контуры OpenCV →
упрощение RDP → гладкие кривые Catmull-Rom с сохранением острых углов (засечки).
На выходе SVG-пути в координатах исходной картинки.
"""
import math
import os

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
A = np.load(os.path.join(HERE, 'logo_alpha.npy'))  # 700×1536, 0..1

# элементы: (x0, y0, x1, y1) в координатах исходника, с запасом
PARTS = {
    'cat':      (632, 111, 867, 450),
    'wordmark': (393, 447, 1138, 574),   # включая акцент над É
    'tagline':  (551, 591, 984, 640),
}
SCALE = 6
CORNER_DEG = 58      # поворот больше этого — острый угол, не сглаживаем
EPS = 1.4            # допуск RDP в увеличенных пикселях


def turn_angle(p0, p1, p2):
    a = math.atan2(p1[1] - p0[1], p1[0] - p0[0])
    b = math.atan2(p2[1] - p1[1], p2[0] - p1[0])
    d = abs((b - a + math.pi) % (2 * math.pi) - math.pi)
    return math.degrees(d)


def contour_to_path(pts, ox, oy):
    n = len(pts)
    if n < 3:
        return ''
    corner = [turn_angle(pts[i - 1], pts[i], pts[(i + 1) % n]) > CORNER_DEG for i in range(n)]

    def P(i):
        return pts[i % n]

    def fmt(x, y):
        return f'{x / SCALE + ox:.2f} {y / SCALE + oy:.2f}'

    d = [f'M{fmt(*P(0))}']
    for i in range(n):
        p0, p1, p2, p3 = P(i - 1), P(i), P(i + 1), P(i + 2)
        if corner[i % n]:
            c1 = (p1[0] + (p2[0] - p1[0]) / 3, p1[1] + (p2[1] - p1[1]) / 3)
        else:
            c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        if corner[(i + 1) % n]:
            c2 = (p2[0] - (p2[0] - p1[0]) / 3, p2[1] - (p2[1] - p1[1]) / 3)
        else:
            c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d.append(f'C{fmt(*c1)} {fmt(*c2)} {fmt(*p2)}')
    d.append('Z')
    return ''.join(d)


def vectorize(box):
    x0, y0, x1, y1 = box
    a = A[y0:y1, x0:x1]
    big = cv2.resize(a, None, fx=SCALE, fy=SCALE, interpolation=cv2.INTER_CUBIC)
    big = cv2.GaussianBlur(big, (0, 0), sigmaX=SCALE * 0.28)
    binary = (big > 0.5).astype(np.uint8) * 255
    contours, _ = cv2.findContours(binary, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    paths, kept = [], 0
    for c in contours:
        if cv2.contourArea(c) < (SCALE * SCALE * 1.5):   # пыль от текстуры фона
            continue
        approx = cv2.approxPolyDP(c, EPS, True).reshape(-1, 2).astype(float)
        if len(approx) < 3:
            continue
        paths.append(contour_to_path([tuple(p) for p in approx], x0, y0))
        kept += len(approx)
    return ''.join(paths), kept, len(paths)


def main():
    out = {}
    for name, box in PARTS.items():
        d, pts, nc = vectorize(box)
        out[name] = (d, box)
        print(f'{name:9} контуров {nc:3}  точек {pts:5}  символов пути {len(d)}')

    def svg(names, pad=8):
        xs0 = min(out[n][1][0] for n in names) - pad
        ys0 = min(out[n][1][1] for n in names) - pad
        xs1 = max(out[n][1][2] for n in names) + pad
        ys1 = max(out[n][1][3] for n in names) + pad
        body = ''.join(f'<path id="{n}" d="{out[n][0]}"/>' for n in names)
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{xs0} {ys0} {xs1 - xs0} {ys1 - ys0}" '
                f'fill="currentColor" fill-rule="evenodd">{body}</svg>')

    os.makedirs(os.path.join(HERE, 'logo'), exist_ok=True)
    files = {
        'cat.svg': ['cat'],
        'wordmark.svg': ['wordmark'],
        'tagline.svg': ['tagline'],
        'lockup.svg': ['cat', 'wordmark', 'tagline'],
    }
    for fn, names in files.items():
        s = svg(names)
        open(os.path.join(HERE, 'logo', fn), 'w').write(s)
        print(f'logo/{fn}: {len(s) / 1024:.1f} КБ')


if __name__ == '__main__':
    main()
