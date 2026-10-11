#!/bin/bash
# clip2png.sh <имя-без-расширения> — сохранить картинку из буфера обмена в «Сайт /Сгенерировано»
O="/Users/maxsnigirev/Claude Code/Kosh-Kuse-Finance/Сайт /Сгенерировано/$1.png"
osascript -e "set f to open for access POSIX file \"$O\" with write permission" -e 'set eof f to 0' -e 'write (the clipboard as «class PNGf») to f' -e 'close access f' || exit 1
python3 -c "import sys,hashlib;from PIL import Image;p=sys.argv[1];im=Image.open(p);print(p.split('/')[-1],im.size,hashlib.md5(open(p,'rb').read()).hexdigest()[:8])" "$O"
