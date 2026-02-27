from PIL import Image, ImageDraw

# create a simple apple icon
img = Image.new('RGBA', (200, 200), (255, 255, 255, 0))
d = ImageDraw.Draw(img)
# body
d.ellipse((50, 50, 150, 150), fill=(200, 0, 0))
# stem
d.rectangle((95, 20, 105, 60), fill=(101, 67, 33))
# leaf
d.polygon([(100, 20), (120, 40), (80, 40)], fill=(0, 128, 0))

img.save('/Users/fireant/.openclaw/media/apple.png')
print('apple.png created in media directory')
