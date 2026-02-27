from PIL import Image, ImageDraw

# create a simple banana icon
canvas = Image.new('RGBA', (300, 200), (0, 0, 0, 0))
d = ImageDraw.Draw(canvas)
# banana body (big ellipse)
d.ellipse((50, 30, 250, 150), fill=(255, 223, 0), outline=(200, 180, 0))
# small brown spots
d.ellipse((220, 45, 230, 55), fill=(160, 100, 0))
d.ellipse((205, 60, 215, 70), fill=(160, 100, 0))
# stem
d.rectangle((240, 22, 252, 36), fill=(101, 67, 33))
# rotate for a banana curve
rot = canvas.rotate(-25, resample=Image.BICUBIC, expand=True)
# center-crop to 200x200
w, h = rot.size
cx, cy = w // 2, h // 2
crop = rot.crop((cx - 100, cy - 100, cx + 100, cy + 100))
path = '/Users/fireant/.openclaw/media/banana.png'
crop.save(path)
print(f'banana.png created in media directory ({path})')
