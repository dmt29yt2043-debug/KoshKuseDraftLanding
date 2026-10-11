"""Собрать лендинг: подставить картинки как data URI в шаблон."""
import base64
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'landing.src.html')
OUT = os.path.join(HERE, 'kosh-kuse-landing.html')

IMAGES = {
    '__IMG_HERO__': 'hero.jpg',
    '__IMG_PAWS__': 'catface.jpg',
    '__IMG_RATION__': 'ration.jpg',
    '__IMG_VET__': 'vet.jpg',
    '__IMG_GADGETS__': 'gadgets.jpg',
    '__IMG_PACK__': 'pack.jpg',
}

with open(SRC, encoding='utf-8') as fh:
    html = fh.read()

# пустой caption не несёт смысла — убираем
html = html.replace('<caption class="visually-hidden-caption"></caption>\n              ', '')

for token, name in IMAGES.items():
    path = os.path.join(HERE, 'assets', name)
    b64 = base64.b64encode(open(path, 'rb').read()).decode('ascii')
    html = html.replace(token, f'data:image/jpeg;base64,{b64}')
    print(f'{name:14} {os.path.getsize(path) // 1024:>4} КБ -> {len(b64) // 1024} КБ base64')

left = [t for t in IMAGES if t in html]
assert not left, f'остались незаменённые плейсхолдеры: {left}'

with open(OUT, 'w', encoding='utf-8') as fh:
    fh.write(html)

print(f'\n{OUT}\nразмер страницы: {os.path.getsize(OUT) / 1024 / 1024:.2f} МБ')
