# Copias redimensionadas de las fotos (los originales no se tocan) + textura de grano
import os, random
from PIL import Image, ImageOps
B = 'C:/Users/jrfmp/Documents/1.RaceUp/Branding RaceUp/'
R5 = 'C:/Users/jrfmp/Downloads/Post 05/'
R6 = B + 'Fotos carreras/Race 06 - Campillos/'
R4 = B + 'Posts IG/Race 04/Post 01/'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fotos')
FOTOS = {
  'r4_bg': R4 + 'IMG_7883.jpeg',
  'r5_5053': R5 + 'IMG_5053.JPG', 'r5_5084': R5 + 'IMG_5084.JPG', 'r5_5181': R5 + 'IMG_5181.JPG',
  'r5_5241': R5 + 'IMG_5241.JPG', 'r5_5272': R5 + 'IMG_5272.JPG',
  'r6_5916': R6 + 'Grupo/IMG_5916.JPG', 'r6_5917': R6 + 'Grupo/IMG_5917.JPG', 'r6_5448': R6 + 'Grupo/IMG_5448.JPG',
  'r6_5447': R6 + 'Grupo/IMG_5447.JPG', 'r6_5549': R6 + 'Destacadas/IMG_5549.JPG', 'r6_5546': R6 + 'Destacadas/IMG_5546.JPG',
  'r6_5864': R6 + 'Destacadas/IMG_5864.JPG', 'r6_5714': R6 + 'Destacadas/IMG_5714.JPG', 'r6_5889': R6 + 'IMG_5889.JPG',
  'r6_5884': R6 + 'IMG_5884.JPG', 'r6_5799': R6 + 'Pilotos/58/IMG_5799.JPG', 'r6_5834': R6 + 'Pilotos/No nú´m/IMG_5834.JPG', 'r6_5908': R6 + 'IMG_5908.JPG', 'r6_5941': R6 + 'Grupo/IMG_5941.JPG',
}
os.makedirs(OUT, exist_ok=True)
for k, f in FOTOS.items():
    dst = os.path.join(OUT, k + '.jpg')
    if os.path.exists(dst): continue
    im = ImageOps.exif_transpose(Image.open(f)).convert('RGB')
    im.thumbnail((2400, 2400), Image.LANCZOS)
    im.save(dst, quality=92)
    print(k, im.size)
# grano: motas claras dispersas, como la textura de los posts T1
random.seed(7)
g = Image.new('RGBA', (1080, 1350), (0, 0, 0, 0)); px = g.load()
for _ in range(26000):
    x, y = random.randrange(1080), random.randrange(1350)
    v = random.randint(150, 255); px[x, y] = (v, v, v, random.randint(40, 150))
g.save(os.path.join(os.path.dirname(OUT), 'assets', 'grano.png'))
# Portada del campeón: recorte 4:5 a alta resolución desde el original (IMG_5916, Rafael Lozano)
dst = os.path.join(OUT, 'r6_campeon.jpg')
if not os.path.exists(dst):
    im = ImageOps.exif_transpose(Image.open(R6 + 'Grupo/IMG_5916.JPG')).convert('RGB')
    k = im.width / 2400
    box = tuple(int(v * k) for v in (1250, 150, 2050, 1150))
    im.crop(box).resize((1080, 1350), Image.LANCZOS).save(dst, quality=93)
    print('campeon', box)
dst = os.path.join(OUT, 'r5_podio1477.jpg')
if not os.path.exists(dst):
    im = ImageOps.exif_transpose(Image.open('C:/Users/jrfmp/Documents/1.RaceUp/Branding RaceUp/Fotos carreras/Race 05 - Karting Mijas/Podio/IMG_1477.jpeg')).convert('RGB')
    im.thumbnail((2400, 2400)); im.save(dst, quality=92); print('podio1477', im.size)
