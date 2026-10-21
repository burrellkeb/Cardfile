"""Draw the app icon: a white card with a blue index tab on ballpoint blue."""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'icons')
os.makedirs(OUT, exist_ok=True)
S = 1024
BLUE, WHITE, INK, TAB = (36, 87, 197), (255, 255, 255), (36, 87, 197), (217, 165, 49)

img = Image.new('RGB', (S, S), BLUE)
d = ImageDraw.Draw(img)
# back card, slightly offset
d.rounded_rectangle((210, 330, 850, 700), 44, fill=(92, 133, 222))
# front card
x0, y0, x1, y1 = 170, 400, 830, 780
d.rounded_rectangle((x0 + 10, y0 + 18, x1 + 10, y1 + 18), 44, fill=(24, 60, 140))
d.rounded_rectangle((x0, y0, x1, y1), 44, fill=WHITE)
# index tab
d.rounded_rectangle((x0 + 60, y0 - 46, x0 + 230, y0 + 20), 22, fill=TAB)
d.rectangle((x0 + 60, y0 - 4, x0 + 230, y0 + 20), fill=WHITE)
# text lines on the card
d.rounded_rectangle((x0 + 60, y0 + 70, x0 + 420, y0 + 112), 21, fill=INK)
d.rounded_rectangle((x0 + 60, y0 + 140, x0 + 300, y0 + 172), 16, fill=(160, 172, 190))
d.rounded_rectangle((x0 + 60, y0 + 250, x0 + 360, y0 + 278), 14, fill=(160, 172, 190))
d.rounded_rectangle((x0 + 60, y0 + 300, x0 + 440, y0 + 328), 14, fill=(160, 172, 190))

for size in (180, 192, 512):
    img.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, f'icon-{size}.png'))
print('icons written to', OUT)
