"""KOSH KUSÉ — приём анкет «Вступить в клуб».

Маленький сервис без зависимостей (стандартная библиотека Python 3.10+):
  POST /api/apply        — анкета с сайта (JSON) → проверка → SQLite;
                           поле form: 'v2' — подробная анкета (по умолчанию), 'v3' — короткая первичная заявка;
  GET  /api/health       — проверка, что сервис жив;
  GET  /admin/           — таблица заявок (пароль ставит Caddy: basic_auth перед /admin);
  GET  /admin/export.csv — выгрузка для Excel;
  POST /admin/status     — смена статуса заявки.
Слушает только 127.0.0.1 — наружу его выводит Caddy.

Запуск локально: KK_PORT=8391 python3 app.py  (база — рядом, в ./state)
На сервере — systemd-юнит kosh-kuse-forms (база в /var/lib/kosh-kuse-forms).
"""
import csv
import hashlib
import html
import io
import json
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

PORT = int(os.environ.get('KK_PORT', '8391'))
STATE = os.environ.get('STATE_DIRECTORY') or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'state')
DB = os.path.join(STATE, 'applications.db')
MSK = timezone(timedelta(hours=3))
# сайт на старом домене шлёт анкету сюда же — ему разрешаем кросс-доменный запрос
CORS_ORIGINS = {'https://kosh-kuse.srv1362562.hstgr.cloud'}
MAX_BODY = 16 * 1024

STATUSES = [('new', 'Новая'), ('contacted', 'Связались'), ('member', 'В клубе'), ('declined', 'Не подошло'), ('test', 'Тест')]
STATUS_NAMES = dict(STATUSES)
# короткая заявка v3: один вопрос — что человек хочет улучшить в заботе о кошке
GOALS = ['Рацион', 'Здоровье и анализы', 'Поведение и привычки', 'Всё в одном месте', 'Пока присматриваюсь', 'Другое']

os.makedirs(STATE, exist_ok=True)
_lock = threading.Lock()


def db():
    con = sqlite3.connect(DB, timeout=10)
    con.row_factory = sqlite3.Row
    return con


with db() as _c:
    _c.execute('PRAGMA journal_mode=WAL')
    _c.execute('''CREATE TABLE IF NOT EXISTS applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'new',
        data TEXT NOT NULL,
        ip TEXT,
        ua TEXT)''')


def _salt():
    p = os.path.join(STATE, 'salt')
    if not os.path.exists(p):
        with open(p, 'w') as f:
            f.write(secrets.token_hex(16))
    return open(p).read().strip()


SALT = _salt()


def ip_hash(ip):
    """IP храним только солёным хешем — для защиты от спама, не для слежки."""
    return hashlib.sha256((SALT + ip).encode()).hexdigest()[:16]


# ---------- проверка анкеты ----------

class Bad(Exception):
    pass


def s(v, limit, field=None, required=False):
    """Строка: обрезаем пробелы, ограничиваем длину, убираем управляющие символы."""
    if v is None:
        v = ''
    if not isinstance(v, (str, int, float)):
        raise Bad('Проверьте поле: ' + (field or 'анкета'))
    v = re.sub(r'[\x00-\x08\x0b-\x1f\x7f]', '', str(v)).strip()
    if len(v) > limit:
        v = v[:limit]
    if required and not v:
        raise Bad('Заполните поле: ' + field)
    return v


def cap(v):
    """Имя — с заглавной буквы, остальное как написали."""
    return v[:1].upper() + v[1:]


def lst(v, limit=12, each=60):
    if not v:
        return []
    if not isinstance(v, list):
        raise Bad('Проверьте анкету')
    return [s(x, each) for x in v[:limit] if s(x, each)]


def phone_ok(v):
    digits = re.sub(r'\D', '', v)
    if not 10 <= len(digits) <= 15:
        raise Bad('Проверьте номер телефона — в нём должно быть 10–15 цифр')
    if len(digits) == 11 and digits[0] == '8':
        digits = '7' + digits[1:]
    if len(digits) == 10:
        digits = '7' + digits
    return '+' + digits


def telegram_ok(v):
    v = v.strip()
    m = re.match(r'^(?:https?://)?(?:t(?:elegram)?\.me/)([A-Za-z0-9_]{5,32})/?$', v)
    if m:
        v = m.group(1)
    v = v.lstrip('@')
    if re.fullmatch(r'[A-Za-z0-9_]{5,32}', v):
        return '@' + v
    if re.fullmatch(r'\+?[\d\s()\-]{10,20}', v):     # вместо ника оставили номер — тоже годится
        return phone_ok(v)
    raise Bad('Проверьте ник в Telegram: латинские буквы, цифры и _, от 5 символов')


def goal_ok(v):
    v = s(v, 40)
    if v not in GOALS:
        raise Bad('Выберите, что хотите улучшить')
    return v


def clean(d):
    if not isinstance(d, dict):
        raise Bad('Пустая анкета')
    if s(d.get('company'), 200):                      # ловушка для ботов: людям это поле не видно
        raise Bad('spam')
    if d.get('consent') is not True:
        raise Bad('Нужно согласие на обработку данных')
    form = s(d.get('form'), 4) or 'v2'                # v2 — подробная анкета, v3 — короткая первичная заявка
    if form not in ('v2', 'v3'):
        raise Bad('Проверьте анкету')
    v3 = form == 'v3'
    cat, diet, hab, con, goal, meta = (d.get(k) or {} for k in ('cat', 'diet', 'habits', 'contact', 'goal', 'meta'))
    if not all(isinstance(x, dict) for x in (cat, diet, hab, con, goal, meta)):
        raise Bad('Проверьте анкету')
    weight = s(cat.get('weight'), 8).replace(',', '.')
    if weight:
        try:
            w = float(weight)
        except ValueError:
            raise Bad('Вес — числом, например 4,5')
        if not 0.3 <= w <= 20:
            raise Bad('Проверьте вес — в килограммах, например 4,5')
        weight = f'{w:g}'.replace('.', ',')
    method = s(con.get('method'), 12)
    if method not in ('telegram', 'phone'):
        raise Bad('Выберите, как с вами связаться')
    raw = s(con.get('value'), 60, 'контакт', required=True)
    value = telegram_ok(raw) if method == 'telegram' else phone_ok(raw)
    sex = s(cat.get('sex'), 2)
    utm = meta.get('utm') if isinstance(meta.get('utm'), dict) else {}
    # в короткой заявке рацион и привычки можно не присылать; если раздел прислали — проверяем как в v2
    diet_sent = not v3 or any(diet.values())
    return {
        'form': form,
        'cat': {
            'sex': sex if sex in ('f', 'm') else ('' if v3 else 'f'),
            'name': cap(s(cat.get('name'), 40, 'имя кошки', required=True)),
            'age': s(cat.get('age'), 40, 'возраст', required=not v3),
            'weight': weight,
            'health': lst(cat.get('health')),
            'health_note': s(cat.get('health_note'), 300),
        },
        'diet': {
            'base': s(diet.get('base'), 60, 'рацион', required=diet_sent),
            'meals': s(diet.get('meals'), 60),
            'water': s(diet.get('water'), 60),
            'avoid': s(diet.get('avoid'), 200),
        },
        'habits': {
            'temper': s(hab.get('temper'), 60),
            'home': s(hab.get('home'), 60),
            'others': lst(hab.get('others')),
            'priority': lst(hab.get('priority')),
        },
        'contact': {
            'name': cap(s(con.get('name'), 60, 'ваше имя', required=True)),
            'method': method,
            'value': value,
            'city': cap(s(con.get('city'), 60, 'город', required=v3)),
        },
        'goal': {                                     # только в v3, в v2 остаётся пустым
            'main': goal_ok(goal.get('main')) if v3 else '',
            'note': s(goal.get('note'), 300) if v3 else '',
        },
        'meta': {
            'page': s(meta.get('page'), 300),
            'ref': s(meta.get('ref'), 300),
            'mode': s(meta.get('mode'), 10),
            'utm': {k: s(v, 100) for k, v in list(utm.items())[:6] if re.fullmatch(r'utm_[a-z]{1,10}', str(k))},
        },
    }


# ---------- защита от потока ----------

_hits = defaultdict(deque)
_all = deque()


def allowed(key):
    now = time.time()
    with _lock:
        q = _hits[key]
        while q and now - q[0] > 600:
            q.popleft()
        while _all and now - _all[0] > 3600:
            _all.popleft()
        if len(q) >= 6 or len(_all) >= 300:            # 6 анкет за 10 минут с одного адреса, 300 в час всего
            return False
        q.append(now)
        _all.append(now)
        return True


# ---------- представление заявок ----------

SEX = {'f': 'кошка', 'm': 'кот'}
METHOD = {'telegram': 'Telegram', 'phone': 'Телефон'}


def row_view(r):
    d = json.loads(r['data'])
    c, di, h, co, m = d['cat'], d.get('diet') or {}, d.get('habits') or {}, d['contact'], d.get('meta') or {}
    g = d.get('goal') or {}                           # у старых строк раздела нет
    created = datetime.fromisoformat(r['created']).astimezone(MSK)
    src = ', '.join(f'{k[4:]}={v}' for k, v in (m.get('utm') or {}).items()) or (m.get('ref') or '')
    return {
        'id': r['id'],
        'status': r['status'],
        'Дата (МСК)': created.strftime('%d.%m.%Y %H:%M'),
        'Имя': co['name'],
        'Связь': METHOD.get(co['method'], co['method']),
        'Контакт': co['value'],
        'Город': co.get('city', ''),
        'Что улучшить': (g.get('main') or '') + (f' — {g["note"]}' if g.get('note') else ''),
        'Кошка': c['name'],
        'Пол': SEX.get(c.get('sex'), ''),
        'Возраст': c.get('age', ''),
        'Вес, кг': c.get('weight', ''),
        'Здоровье': ', '.join(c.get('health') or []) + (f' — {c["health_note"]}' if c.get('health_note') else ''),
        'Рацион': di.get('base', ''),
        'Раз в день': di.get('meals', ''),
        'Вода': di.get('water', ''),
        'Нельзя / не ест': di.get('avoid', ''),
        'Характер': h.get('temper', ''),
        'Где живёт': h.get('home', ''),
        'Кто ещё дома': ', '.join(h.get('others') or []),
        'Что важнее': ', '.join(h.get('priority') or []),
        'Источник': src,
        'Версия': d.get('form', ''),
    }


COLS = ['Дата (МСК)', 'Имя', 'Связь', 'Контакт', 'Город', 'Что улучшить', 'Кошка', 'Пол', 'Возраст', 'Вес, кг', 'Здоровье',
        'Рацион', 'Раз в день', 'Вода', 'Нельзя / не ест', 'Характер', 'Где живёт', 'Кто ещё дома', 'Что важнее', 'Источник', 'Версия']
CARD_TOP = COLS[:6] + ['Версия']                      # это карточка показывает в шапке, остальное — списком


def contact_link(v):
    k, val = v['Связь'], v['Контакт']
    e = html.escape(val)
    if val.startswith('@'):
        return f'<a href="https://t.me/{html.escape(val[1:])}" target="_blank" rel="noopener">{e}</a>'
    if val.startswith('+'):
        return f'<a href="tel:{e}">{e}</a>'
    return e


ADMIN_CSS = '''
:root{--ivory:#F7F4EB;--linen:#E8DFC9;--paper:#FCFAF5;--ink:#2B2A26;--muted:#5A5249;--line:rgba(43,42,38,.14);--burgundy:#4A1F27}
*{box-sizing:border-box}body{margin:0;background:var(--ivory);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
header{position:sticky;top:0;z-index:2;background:rgba(247,244,235,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);padding:14px 20px;display:flex;flex-wrap:wrap;gap:12px 20px;align-items:center}
h1{margin:0;font:500 18px/1.2 Georgia,serif;letter-spacing:.06em}h1 b{color:var(--burgundy);font-weight:500}
.count{color:var(--muted)}nav{display:flex;flex-wrap:wrap;gap:6px}nav a,.btn{display:inline-flex;align-items:center;height:32px;padding:0 12px;border-radius:999px;border:1px solid var(--line);color:var(--ink);text-decoration:none;font-size:13px}
nav a.on{border-color:var(--burgundy);color:var(--burgundy)}.btn{margin-left:auto;background:var(--burgundy);border-color:var(--burgundy);color:var(--ivory)}
main{padding:16px 20px 40px}.empty{color:var(--muted);padding:40px 0}
.cards{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}
.card{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:14px 16px;display:flex;flex-direction:column;gap:8px}
.top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.top>div:first-child{flex:1;min-width:0}.who{font-weight:600;font-size:15px}.when{color:var(--muted);font-size:12px}
.ct a{color:var(--burgundy)}.goal{margin:6px 0 2px;padding:6px 10px;border-left:3px solid var(--burgundy);background:var(--linen);border-radius:0 10px 10px 0;font-size:13px}.goal span{color:var(--muted)}
dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:13px}dt{color:var(--muted)}dd{margin:0}
select{font:inherit;font-size:12px;height:28px;border-radius:999px;border:1px solid var(--line);background:var(--ivory);padding:0 8px;color:var(--ink)}
select.s-new{border-color:var(--burgundy);color:var(--burgundy)}.saved{font-size:11px;color:var(--muted);height:14px}
'''


def admin_page(rows, flt, total, counts):
    tabs = [('', 'Все, кроме тестов')] + STATUSES
    nav = ''.join(f'<a href="/admin/{"?s=" + k if k else ""}" class="{"on" if flt == k else ""}">{n}'
                  f'{" · " + str(counts.get(k, 0)) if k else ""}</a>' for k, n in tabs)
    cards = []
    for r in rows:
        v = row_view(r)
        opts = ''.join(f'<option value="{k}"{" selected" if k == v["status"] else ""}>{n}</option>' for k, n in STATUSES)
        dl = ''.join(f'<dt>{html.escape(k)}</dt><dd>{html.escape(v[k])}</dd>' for k in COLS if k not in CARD_TOP and v[k])
        goal = f'<div class="goal"><span>Что улучшить:</span> {html.escape(v["Что улучшить"])}</div>' if v['Что улучшить'] else ''
        cards.append(f'''<article class="card"><div class="top"><div><div class="who">{html.escape(v["Имя"])}</div>
<div class="ct">{v["Связь"]}: {contact_link(v)}{(" · " + html.escape(v["Город"])) if v["Город"] else ""}</div>{goal}
<div class="when">№{v["id"]} · {v["Дата (МСК)"]}{(" · " + html.escape(v["Версия"])) if v["Версия"] else ""}</div></div>
<div><select data-id="{v["id"]}" class="s-{v["status"]}" aria-label="Статус заявки">{opts}</select><div class="saved"></div></div></div>
<dl>{dl}</dl></article>''')
    body = '<div class="cards">' + ''.join(cards) + '</div>' if cards else '<p class="empty">Пока заявок нет.</p>'
    return f'''<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Заявки — KOSH KUSÉ</title><style>{ADMIN_CSS}</style></head><body>
<header><h1>KOSH <b>KUSÉ</b> · заявки</h1><span class="count">всего {total}</span><nav>{nav}</nav>
<a class="btn" href="/admin/export.csv{"?s=" + flt if flt else ""}">Скачать для Excel</a></header>
<main>{body}</main>
<script>
document.querySelectorAll('select[data-id]').forEach(function(s){{s.addEventListener('change',function(){{
  var note=s.nextElementSibling;note.textContent='сохраняю…';
  fetch('/admin/status',{{method:'POST',headers:{{'Content-Type':'application/json','X-KK':'1'}},body:JSON.stringify({{id:+s.dataset.id,status:s.value}})}})
  .then(function(r){{if(!r.ok)throw 0;s.className='s-'+s.value;note.textContent='сохранено'}}).catch(function(){{note.textContent='не сохранилось'}});
}})}});
</script></body></html>'''


# ---------- HTTP ----------

class H(BaseHTTPRequestHandler):
    server_version = 'kk-forms'
    sys_version = ''

    def log_message(self, fmt, *args):            # в журнал — без личных данных
        sys.stderr.write('%s %s\n' % (self.command, self.path.split('?')[0]))

    def client_ip(self):
        xff = self.headers.get('X-Forwarded-For', '')
        return (xff.split(',')[0].strip() if xff else self.client_address[0]) or '-'

    def send(self, code, body, ctype='application/json; charset=utf-8', extra=None):
        b = body if isinstance(body, bytes) else body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(b)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(b)

    def cors(self):
        o = self.headers.get('Origin', '')
        return {'Access-Control-Allow-Origin': o, 'Vary': 'Origin'} if o in CORS_ORIGINS else {}

    def j(self, code, obj):
        self.send(code, json.dumps(obj, ensure_ascii=False), extra=self.cors())

    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n > MAX_BODY:
            raise Bad('Слишком большая анкета')
        return self.rfile.read(n) if n else b''

    def do_OPTIONS(self):
        if self.path.split('?')[0] == '/api/apply' and self.cors():
            self.send(204, b'', extra={**self.cors(), 'Access-Control-Allow-Methods': 'POST',
                                       'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400'})
        else:
            self.send(404, b'')

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == '/api/health':
            return self.j(200, {'ok': True})
        if u.path in ('/admin', '/admin/'):
            return self.admin(u)
        if u.path == '/admin/export.csv':
            return self.export(u)
        self.send(404, '{"ok":false}')

    def do_POST(self):
        p = self.path.split('?')[0]
        if p == '/api/apply':
            return self.apply()
        if p == '/admin/status':
            return self.status()
        self.send(404, '{"ok":false}')

    def apply(self):
        if 'application/json' not in (self.headers.get('Content-Type') or ''):
            return self.j(415, {'ok': False, 'error': 'Нужен JSON'})
        ip = ip_hash(self.client_ip())
        try:
            raw = self.body()
            data = clean(json.loads(raw or b'{}'))
        except Bad as e:
            if str(e) == 'spam':
                return self.j(200, {'ok': True})       # боту отвечаем «успешно» и ничего не храним
            return self.j(400, {'ok': False, 'error': str(e)})
        except (ValueError, UnicodeDecodeError):
            return self.j(400, {'ok': False, 'error': 'Не получилось прочитать анкету'})
        if not allowed(ip):
            return self.j(429, {'ok': False, 'error': 'Слишком много заявок подряд. Попробуйте чуть позже.'})
        with _lock, db() as con:
            cur = con.execute('INSERT INTO applications (created, data, ip, ua) VALUES (?,?,?,?)',
                              (datetime.now(timezone.utc).isoformat(timespec='seconds'),
                               json.dumps(data, ensure_ascii=False), ip, s(self.headers.get('User-Agent'), 200)))
            new_id = cur.lastrowid
        sys.stderr.write(f'apply ok id={new_id}\n')
        self.j(200, {'ok': True, 'id': new_id})

    def rows(self, flt):
        with db() as con:
            if flt in STATUS_NAMES:
                return con.execute('SELECT * FROM applications WHERE status=? ORDER BY id DESC', (flt,)).fetchall()
            return con.execute("SELECT * FROM applications WHERE status!='test' ORDER BY id DESC").fetchall()

    def admin(self, u):
        flt = (parse_qs(u.query).get('s') or [''])[0]
        flt = flt if flt in STATUS_NAMES else ''
        with db() as con:
            total = con.execute('SELECT COUNT(*) FROM applications').fetchone()[0]
            counts = dict(con.execute('SELECT status, COUNT(*) FROM applications GROUP BY status').fetchall())
        self.send(200, admin_page(self.rows(flt), flt, total, counts), 'text/html; charset=utf-8',
                  {'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer'})

    def export(self, u):
        flt = (parse_qs(u.query).get('s') or [''])[0]
        buf = io.StringIO()
        w = csv.writer(buf, delimiter=';', lineterminator='\r\n')      # Excel с русской локалью ждёт «;»
        w.writerow(['№', 'Статус'] + COLS)
        for r in self.rows(flt if flt in STATUS_NAMES else ''):
            v = row_view(r)
            w.writerow([v['id'], STATUS_NAMES.get(v['status'], v['status'])] + [v[c] for c in COLS])
        name = 'kosh-kuse-zayavki-' + datetime.now(MSK).strftime('%Y-%m-%d') + '.csv'
        self.send(200, '﻿' + buf.getvalue(), 'text/csv; charset=utf-8',
                  {'Content-Disposition': f'attachment; filename="{name}"'})

    def status(self):
        # только из нашей же страницы: свой заголовок не подставить простой формой с чужого сайта
        if self.headers.get('X-KK') != '1' or 'application/json' not in (self.headers.get('Content-Type') or ''):
            return self.send(403, '{"ok":false}')
        try:
            d = json.loads(self.body() or b'{}')
            rid, st = int(d.get('id')), str(d.get('status'))
        except (Bad, ValueError, TypeError):
            return self.send(400, '{"ok":false}')
        if st not in STATUS_NAMES:
            return self.send(400, '{"ok":false}')
        with _lock, db() as con:
            n = con.execute('UPDATE applications SET status=? WHERE id=?', (st, rid)).rowcount
        self.send(200 if n else 404, json.dumps({'ok': bool(n)}))


if __name__ == '__main__':
    srv = ThreadingHTTPServer(('127.0.0.1', PORT), H)
    srv.daemon_threads = True
    sys.stderr.write(f'kk-forms on 127.0.0.1:{PORT}, db {DB}\n')
    srv.serve_forever()
