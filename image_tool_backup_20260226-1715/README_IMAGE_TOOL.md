# Image Generator Utility

Usage examples:

Generate an apple (400px):

```bash
python3 create_image.py --shape apple --size 400
```

Generate a tangerine with hex color:

```bash
python3 create_image.py --shape tangerine --size 400 --color #ff7f00
```

Generate a banana and save to custom path:

```bash
python3 create_image.py --shape banana --size 400 --output ~/.openclaw/media/banana_custom.png
```

Send via OpenClaw CLI:

```bash
openclaw message send --channel telegram --target 477743685 --message "이미지" --media ~/.openclaw/media/apple.png
```
