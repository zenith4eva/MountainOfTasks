"""Turns the frame folders from scripts/shots.mjs into animated WebPs. Needs Pillow."""
import os
import sys

from PIL import Image, ImageChops

frames, out = sys.argv[1], sys.argv[2]

# name: (crop box or None, output width or None)
JOBS = {'desktop': ((56, 0, 1100, 500), 880), 'phone': (None, None)}

for name, (box, width) in JOBS.items():
    files = sorted(os.listdir(os.path.join(frames, name)))
    stamps = [int(f.split('_')[1][:-4]) for f in files]
    imgs, durs = [], []
    for i, f in enumerate(files):
        im = Image.open(os.path.join(frames, name, f)).convert('RGB')
        if box:
            im = im.crop(box)
        if width and im.width != width:
            im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
        d = stamps[i + 1] - stamps[i] if i + 1 < len(stamps) else 0
        if imgs and not ImageChops.difference(imgs[-1], im).getbbox():
            durs[-1] += d  # identical frame: hold the previous one longer
            continue
        imgs.append(im)
        durs.append(d)
    durs[-1] = max(durs[-1], 1800)
    path = os.path.join(out, f'{name}.webp')
    imgs[0].save(path, save_all=True, append_images=imgs[1:], duration=durs, loop=0, quality=80, method=6)
    print(f'{path}: {len(imgs)} frames, {sum(durs)} ms, {os.path.getsize(path) // 1024} KB')
