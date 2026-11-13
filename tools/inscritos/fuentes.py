# Genera las fuentes estáticas de las imágenes de inscritos (lib/inscritos/recursos/fuentes) a partir de las fuentes
# variables de la web (@fontsource-variable). Satori no lee woff2 ni fuentes variables, por eso se instancian en TTF.
# Uso (desde la raíz del repo, con fontTools y brotli instalados: pip install fonttools brotli):
#   python tools/inscritos/fuentes.py . lib/inscritos/recursos/fuentes
import sys, os
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

repo, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
base = os.path.join(repo, 'node_modules', '@fontsource-variable')

ESTILOS = [
    ('archivo', {'wght': 900, 'wdth': 100}, 'Archivo-Black'),       # placas, números
    ('archivo', {'wght': 900, 'wdth': 125}, 'Archivo-ExpBlack'),    # categoría
    ('archivo', {'wght': 800, 'wdth': 62}, 'Archivo-CondXBold'),    # nombres
    ('inter', {'wght': 500}, 'Inter-Medium'),
    ('inter', {'wght': 700}, 'Inter-Bold'),
]
for fam, loc, nombre in ESTILOS:
    for sub in ('latin', 'latin-ext'):
        src = os.path.join(base, fam, 'files', f'{fam}-{sub}-standard-normal.woff2')
        if not os.path.exists(src):
            src = os.path.join(base, fam, 'files', f'{fam}-{sub}-wght-normal.woff2')
        f = TTFont(src)
        ejes = {a.axisTag: (a.minValue, a.maxValue) for a in f['fvar'].axes}
        l = {k: max(min(v, ejes[k][1]), ejes[k][0]) for k, v in loc.items() if k in ejes}
        g = instantiateVariableFont(f, l, inplace=False)
        if 'fvar' in g:  # ejes que quedan (p. ej. opsz) en su valor por defecto
            g = instantiateVariableFont(g, {a.axisTag: a.defaultValue for a in g['fvar'].axes})
        g.flavor = None
        g.save(os.path.join(out, f'{nombre}-{sub}.ttf'))
        print(nombre, sub, l)
