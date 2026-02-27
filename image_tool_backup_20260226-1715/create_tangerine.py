from PIL import Image, ImageDraw

# create a simple tangerine icon
img = Image.new('RGBA', (200, 200), (255, 255, 255, 0))
d = ImageDraw.Draw(img)
# body
r = 80
d.ellipse((20, 20, 20+2*r, 20+2*r), fill=(255, 165, 0))
# segments lines
for angle in range(0, 360, 45):
    x1 = 20 + r + r * 0.9 * ImageDraw.math.cos(ImageDraw.math.radians(angle))
    y1 = 20 + r + r * 0.9 * ImageDraw.math.sin(ImageDraw.math.radians(angle))
    x2 = 20 + r + r * ImageDraw.math.cos(ImageDraw.math.radians(angle))
    y2 = 20 + r + r * ImageDraw.math.sin(ImageDraw.math.radians(angle))
    d.line((x1, y1, x2, y2), fill=(255, 140, 0), width=3)
# stem
d.rectangle((95, 0, 105, 30), fill=(101, 67, 33))
# leaf
d.polygon([(100, 0), (120, 20), (80, 20)], fill=(0, 128, 0))

path = '/Users/fireant/.openclaw/media/tangerine.png'
img.save(path)
print(f'tangerine.png created in media directory ({path})')
