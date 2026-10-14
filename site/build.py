"""Сборка сайта KOSH KUSÉ из шаблона site.src.html.

- шрифты (Value Sans Pro из исходного HTML заказчика, Cormorant Garamond по OFL) — файлами в dist/fonts
  с предзагрузкой; в artifact.html — base64, чтобы он оставался одним файлом;
- подставляет символы логотипа с точными viewBox и полный кот для заставки;
- превращает {{img:name}} в src/srcset/width/height по реальным файлам в img/;
- кладёт dist/index.html (полный документ) и dist/artifact.html (без обёртки html/head/body).
"""
import base64
import hashlib
import glob
import os
import re
import shutil

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SCR = os.path.dirname(HERE)
DIST = os.path.join(HERE, 'dist')

# (семейство, вес, файл в src_fonts, unicode-range, предзагрузка). Курсив на странице не используется.
# Cormorant Garamond — вариативный (один файл на 400–500), подмножества кириллица/латиница как у Google Fonts, лицензия OFL.
FONTS = [('Value Sans Pro', '400', 'ValueSansPro-400-normal.woff2', None, True),
         ('Value Sans Pro', '500', 'ValueSansPro-500-normal.woff2', None, False),
         ('Value Sans Pro', '700', 'ValueSansPro-700-normal.woff2', None, False),
         ('Cormorant Garamond', '400 500', 'CormorantGaramond-var-cyrillic.woff2',
          'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116', True),
         ('Cormorant Garamond', '400 500', 'CormorantGaramond-var-latin.woff2',
          'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, '
          'U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD', False)]
FONT_LICENSES = ['Cormorant-OFL.txt']


def have(fn):
    """Value Sans Pro — коммерческий шрифт, в публичный репозиторий не кладём. Если файла нет — пропускаем
    (сайт возьмёт системный гротеск), сборка не падает. Файлы — в src_fonts/, передаются отдельно."""
    ok = os.path.exists(os.path.join(SCR, 'src_fonts', fn))
    if not ok:
        print(f'  нет шрифта src_fonts/{fn} — пропускаю (будет системный шрифт)')
    return ok

NB = '\u00a0'
SHORT = r'(?<!\w)(в|во|и|с|со|к|ко|о|об|у|а|не|ни|но|по|за|из|от|до|на|для|без|при|под|над|про|мы|вы|её|Под|Над|Про|В|И|С|К|О|У|А|Не|Ни|Но|По|За|Из|От|До|На|Для|Без|При|Мы|Вы|Её) '


def typograph(h):
    """Неразрывные пробелы: после коротких предлогов и союзов, перед тире, между числом и единицей.
    Трогаем только текст — не теги, не <script> и не <style>."""
    parts = re.split(r'(<script\b.*?</script>|<style\b.*?</style>|<[^>]+>)', h, flags=re.S | re.I)
    for i, p in enumerate(parts):
        if not p or p.startswith('<'):
            continue
        p = re.sub(r' (—|–)', NB + r'\1', p)
        p = re.sub(SHORT, lambda m: m.group(1) + NB, p)
        p = re.sub(r'(\d) (г|кг|мл|мин|ч|дней|из)\b', r'\1' + NB + r'\2', p)
        parts[i] = p
    return ''.join(parts)


def round_path(d):
    """Точность путей логотипа до десятых — на экране разницы нет, а вес меньше."""
    return re.sub(r'-?\d+\.\d+', lambda m: f'{float(m.group()):.1f}'.rstrip('0').rstrip('.'), d)


def font_css(inline):
    """inline=False — ссылки на fonts/*.woff2 (сайт); inline=True — base64 (артефакт в один файл)."""
    out = []
    for fam, w, fn, rng, _ in FONTS:
        if not have(fn):
            continue
        if inline:
            src = 'data:font/woff2;base64,' + base64.b64encode(open(os.path.join(SCR, 'src_fonts', fn), 'rb').read()).decode()
        else:
            src = f'fonts/{fn}?v={ver(os.path.join(SCR, "src_fonts", fn))}'
        out.append("@font-face{font-family:'%s';font-weight:%s;font-style:normal;font-display:swap;"
                   "src:url(%s) format('woff2')%s}" % (fam, w, src, f';unicode-range:{rng}' if rng else ''))
    return '\n'.join(out)


def font_preload():
    return '\n'.join(f'<link rel="preload" as="font" type="font/woff2" href="fonts/{fn}?v={ver(os.path.join(SCR, "src_fonts", fn))}" crossorigin>'
                     for _, _, fn, _, pre in FONTS if pre and os.path.exists(os.path.join(SCR, 'src_fonts', fn)))


def logo_part(name):
    s = open(os.path.join(SCR, 'logo', f'{name}.svg')).read()
    d = round_path(re.search(r' d="([^"]+)"', s).group(1))
    nums = [float(v) for v in re.findall(r'-?\d+\.?\d*', d)]
    xs, ys = nums[0::2], nums[1::2]
    pad = 1.5
    x0, y0 = min(xs) - pad, min(ys) - pad
    vb = f'{x0:.1f} {y0:.1f} {max(xs) - min(xs) + 2 * pad:.1f} {max(ys) - min(ys) + 2 * pad:.1f}'
    return d, vb


def split_subpaths(d):
    """Разбить путь на подконтуры — для заставки нужен отдельный path на каждый контур."""
    return ['M' + p for p in d.split('M') if p.strip()]


def letter_groups(d):
    """Разложить надпись на буквы: подконтуры, чьи диапазоны по X пересекаются (О с внутренним
    контуром, É с акцентом), — одна буква. Нужны прелоадеру, чтобы буквы поднимались по одной."""
    subs = []
    for p in split_subpaths(d):
        nums = [float(v) for v in re.findall(r'-?\d+\.?\d*', p)]
        xs = nums[0::2]
        subs.append([min(xs), max(xs), p])
    subs.sort(key=lambda t: t[0])
    groups = []
    for x0, x1, p in subs:
        if groups and x0 < groups[-1][1] - 2:
            groups[-1][1] = max(groups[-1][1], x1)
            groups[-1][2].append(p)
        else:
            groups.append([x0, x1, [p]])
    return [''.join(g[2]) for g in groups]


# подписи к картинкам — рядом со сборкой, потому что набор фото меняется
ALTS = {
    'clm-video': 'Чёрная кошка сидит на светлом подоконнике и смотрит в открытое окно на солнечный город у моря',
    'one2one': 'Две кошки едят из одинаковых керамических мисок: слева пушистая домашняя, справа полосатая кошка в светлой комнате приюта с домиком-когтеточкой',
    'c-food': 'Керамическая миска с кусочками отварной белой рыбы на травертиновой столешнице',
    'c-water': 'Чёрно-белая кошка пьёт воду из прозрачной стеклянной миски',
    'c-early': 'Кошка окраса колор-пойнт с голубыми глазами спокойно сидит у окна',
    'c-move': 'Абиссинская кошка идёт по солнечному дубовому полу, подняв хвост',
    'c-calm': 'Пушистая кремовая кошка крепко спит, свернувшись в льняном пледе',
    's-1': 'Утро на светлой кухне: женщина наливает кофе, рядом на стуле сидит черепаховая кошка',
    's-2': 'Вечер: женщина читает в постели, у неё на груди сидит полосатая кошка и заглядывает в книгу',
    's-3': 'Женщина сидит у окна и прижимает к плечу серебристую полосатую кошку',
    's-4': 'Женские руки расчёсывают деревянной щёткой пушистого мейн-куна, он держит лапой её палец',
}


def ver(path):
    """Короткий хеш содержимого — в адрес файла (?v=…): новая картинка с тем же именем не застрянет в кэше телефона."""
    return hashlib.md5(open(path, 'rb').read()).hexdigest()[:8]


def img_attrs(name):
    files = glob.glob(os.path.join(HERE, 'img', f'{name}-*.webp'))
    if not files:
        raise SystemExit(f'нет картинки {name}')
    vs = []
    for f in files:
        w, h = Image.open(f).size
        vs.append((w, h, os.path.basename(f)))
    vs.sort()
    # одинаковые по размеру варианты (исходник меньше заказанной ширины) — оставляем один
    uniq = {}
    for w, h, fn in vs:
        uniq.setdefault(w, (w, h, fn))
    vs = sorted(uniq.values())
    w0, h0, fn0 = vs[0]
    v = lambda fn: f'img/{fn}?v={ver(os.path.join(HERE, "img", fn))}'
    src = v(vs[-1][2]) if len(vs) == 1 else v(fn0)
    srcset = ', '.join(f'{v(fn)} {w}w' for w, h, fn in vs)
    return f'src="{src}" srcset="{srcset}" width="{vs[-1][0]}" height="{vs[-1][1]}"'


def main():
    s = open(os.path.join(HERE, 'site.src.html'), encoding='utf-8').read()

    symbols = []
    for name in ['cat', 'wordmark', 'tagline']:
        d, vb = logo_part(name)
        symbols.append(f'<symbol id="kk-{name}" viewBox="{vb}"><path fill-rule="evenodd" d="{d}"/></symbol>')
        _, _, w, h = vb.split()
        s = s.replace(f'<!--VB:{name}-->', f'0 0 {w} {h}')   # обёртка в своих координатах, смещение — внутри символа
    s = s.replace('<!--SYMBOLS-->', '\n    '.join(symbols))

    # заставка: линия рисуется по отдельным контурам (.st), заливка — символ kk-cat целиком с evenodd (.fl),
    # иначе внутренние «дыры» линейного рисунка заливаются сплошным пятном. Заливка — ссылкой на символ,
    # а не второй копией пути: до старта заставки браузеру нужно скачать как можно меньше
    d, vb = logo_part('cat')
    x0, y0, w, h = vb.split()
    strokes = ''.join(f'<path class="st" d="{p}"/>' for p in split_subpaths(d))
    s = s.replace('<!--INTRO_CAT-->', f'<svg class="i-cat" viewBox="{vb}">{strokes}'
                                      f'<use class="fl" href="#kk-cat" x="{x0}" y="{y0}" width="{w}" height="{h}"/></svg>')

    # надпись для прелоадера: буквы — отдельными группами
    d, vb = logo_part('wordmark')
    letters = ''.join(f'<g class="lt" style="--k:{i}"><path fill-rule="evenodd" d="{g}"/></g>' for i, g in enumerate(letter_groups(d)))
    s = s.replace('<!--INTRO_WORD-->', f'<svg class="i-word" viewBox="{vb}" fill="currentColor">{letters}</svg>')

    for k, v in ALTS.items():
        s = s.replace(f'<!--ALT:{k}-->', v)
    s = s.replace('<!--SCRIPT-->', '<script>\n' + open(os.path.join(HERE, 'script.js'), encoding='utf-8').read() + '</script>')

    hero = img_attrs('hero')
    s = s.replace('<!--HERO_SRCSET-->', re.search(r'srcset="([^"]+)"', hero).group(1))
    s = s.replace('<!--HERO_SRC-->', re.search(r'src="([^"]+)"', hero).group(1))

    s = re.sub(r'\{\{img:([a-z0-9-]+)\}\}', lambda m: img_attrs(m.group(1)), s)
    s = typograph(s)
    site = s.replace('/*FONTS*/', font_css(False)).replace('<!--FONT_PRELOAD-->', font_preload())
    art = s.replace('/*FONTS*/', font_css(True)).replace('<!--FONT_PRELOAD-->\n', '')
    for out in (site, art):
        left = re.findall(r'\{\{[^}]+\}\}|<!--(?:VB|SYMBOLS|INTRO|HERO|ALT|SCRIPT|FONT)[^>]*-->|/\*FONTS\*/', out)
        assert not left, left

    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    os.makedirs(os.path.join(DIST, 'img'))
    os.makedirs(os.path.join(DIST, 'fonts'))
    for f in glob.glob(os.path.join(HERE, 'img', '*.webp')):
        shutil.copy(f, os.path.join(DIST, 'img'))
    for fn in [f[2] for f in FONTS] + FONT_LICENSES:
        if os.path.exists(os.path.join(SCR, 'src_fonts', fn)):
            shutil.copy(os.path.join(SCR, 'src_fonts', fn), os.path.join(DIST, 'fonts'))
    open(os.path.join(DIST, 'index.html'), 'w', encoding='utf-8').write(site)
    # служебные страницы (политика, условия, контакты) — как есть, в корень
    for f in glob.glob(os.path.join(HERE, 'pages', '*.html')):
        shutil.copy(f, DIST)
    # иконка сайта — силуэт кошки бургунди (брендбук: силуэт как автономный элемент)
    d, vb = logo_part('cat')
    open(os.path.join(DIST, 'favicon.svg'), 'w', encoding='utf-8').write(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}"><path fill="#4A1F27" fill-rule="evenodd" d="{d}"/></svg>')

    # версия для артефакта: шрифты внутри, без doctype/html/head/body — обёртку добавит хостинг
    a = re.sub(r'<!doctype html>\s*<html[^>]*>\s*<head>', '', art, flags=re.I)
    a = re.sub(r'<meta charset[^>]*>\s*<meta name="viewport"[^>]*>\s*', '', a)
    a = a.replace('</head>', '').replace('<body>', '').replace('</body>', '').replace('</html>', '')
    open(os.path.join(DIST, 'artifact.html'), 'w', encoding='utf-8').write(a.strip() + '\n')

    imgs = sum(os.path.getsize(f) for f in glob.glob(os.path.join(DIST, 'img', '*')))
    fonts = sum(os.path.getsize(f) for f in glob.glob(os.path.join(DIST, 'fonts', '*.woff2')))
    print(f'index.html {os.path.getsize(os.path.join(DIST, "index.html")) / 1024:.0f} КБ, '
          f'шрифты {fonts / 1024:.0f} КБ, '
          f'картинки {imgs / 1024 / 1024:.2f} МБ ({len(os.listdir(os.path.join(DIST, "img")))} файлов)')


if __name__ == '__main__':
    main()
