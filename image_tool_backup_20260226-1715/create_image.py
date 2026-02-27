#!/usr/bin/env python3
import argparse
from PIL import Image, ImageDraw
import os

MEDIA_DIR = os.path.expanduser('~/ .openclaw/media').replace(' ', '')
# Fallback to existing media path
if not os.path.isdir(MEDIA_DIR):
    MEDIA_DIR = os.path.expanduser('~/.openclaw/media')


def draw_apple(size, color):
    img = Image.new('RGBA', (size, size), (255, 255, 255, 0))
    d = ImageDraw.Draw(img)
    pad = size // 6
    d.ellipse((pad, pad, size - pad, size - pad), fill=color)
    stem_w = size // 12
    d.rectangle((size//2 - stem_w//2, pad//4, size//2 + stem_w//2, pad), fill=(101,67,33))
    d.polygon([(size//2, pad//4), (size//2 + 30, pad + 10), (size//2 - 30, pad + 10)], fill=(0,128,0))
    return img


def draw_tangerine(size, color):
    img = Image.new('RGBA', (size, size), (255,255,255,0))
    d = ImageDraw.Draw(img)
    r = size * 0.35
    cx = cy = size//2
    d.ellipse((cx-r, cy-r, cx+r, cy+r), fill=color)
    # simple segment lines
    for a in range(0, 360, 45):
        import math
        x1 = cx + r*0.1*math.cos(math.radians(a))
        y1 = cy + r*0.1*math.sin(math.radians(a))
        x2 = cx + r*0.9*math.cos(math.radians(a))
        y2 = cy + r*0.9*math.sin(math.radians(a))
        d.line((x1,y1,x2,y2), fill=(255,140,0), width=max(1, size//60))
    d.rectangle((cx-6, cy- r - size*0.12, cx+6, cy- r + size*0.04), fill=(101,67,33))
    d.polygon([(cx, cy- r - size*0.12), (cx+size*0.12, cy- r + size*0.02), (cx-size*0.12, cy- r + size*0.02)], fill=(0,128,0))
    return img


def draw_banana(size, color):
    canvas = Image.new('RGBA', (size, size), (0,0,0,0))
    d = ImageDraw.Draw(canvas)
    # draw ellipse then rotate to curve
    w = int(size*0.67)
    h = int(size*0.4)
    left = (size - w)//2
    top = (size - h)//2
    d.ellipse((left, top, left + w, top + h), fill=color, outline=(200,180,0))
    # stem and spots
    d.rectangle((left + w - size//12, top - size//12, left + w - size//20, top + size//20), fill=(101,67,33))
    d.ellipse((left + w - size//6, top + size//10, left + w - size//8, top + size//6), fill=(160,100,0))
    rot = canvas.rotate(-25, resample=Image.BICUBIC, expand=True)
    # center-crop
    rw, rh = rot.size
    cx, cy = rw//2, rh//2
    crop = rot.crop((cx - size//2, cy - size//2, cx + size//2, cy + size//2))
    return crop


def parse_color(s):
    # accept hex like #RRGGBB or common names
    s = s.strip()
    if s.startswith('#') and len(s) == 7:
        return tuple(int(s[i:i+2], 16) for i in (1,3,5))
    # fallback to basic map
    cmap = {
        'red':(200,0,0), 'orange':(255,165,0), 'yellow':(255,223,0), 'green':(0,128,0)
    }
    return cmap.get(s.lower(), (255,165,0))


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--shape', required=True, choices=['apple','tangerine','banana'])
    p.add_argument('--size', type=int, default=400)
    p.add_argument('--color', type=str, default='orange')
    p.add_argument('--output', type=str, default=None)
    args = p.parse_args()

    color = parse_color(args.color)
    if args.shape == 'apple':
        img = draw_apple(args.size, color)
    elif args.shape == 'tangerine':
        img = draw_tangerine(args.size, color)
    else:
        img = draw_banana(args.size, color)

    out = args.output or os.path.join(MEDIA_DIR, f"{args.shape}.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.save(out)
    print(f'Image saved: {out}')
