import sys
from PIL import Image
a,b,o=sys.argv[1:4]
A=Image.open(a).convert('RGB'); B=Image.open(b).convert('RGB').resize(A.size)
W=Image.new('RGB',(A.width*2,A.height)); W.paste(A,(0,0)); W.paste(B,(A.width,0)); W.thumbnail((1600,1600)); W.save(o,quality=88)
