import sys
from PIL import Image

if len(sys.argv) != 4:
    print("Usage: python combine_images.py input1.png input2.png output.png")
    sys.exit(1)

img1 = Image.open(sys.argv[1])
img2 = Image.open(sys.argv[2])

width = img1.width + img2.width
height = max(img1.height, img2.height)

combined = Image.new('RGB', (width, height))
combined.paste(img1, (0, 0))
combined.paste(img2, (img1.width, 0))

combined.save(sys.argv[3])
print(f"Combined image saved to {sys.argv[3]}")