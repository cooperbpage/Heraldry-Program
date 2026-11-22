"""Segment a reference into colour masks at 4x scale and save previews."""
import sys, numpy as np, cv2
from PIL import Image
src, out, kind = sys.argv[1], sys.argv[2], sys.argv[3]
im = np.asarray(Image.open(src).convert('RGB'))
S = 4
big = cv2.resize(im, None, fx=S, fy=S, interpolation=cv2.INTER_CUBIC)
hsv = cv2.cvtColor(big, cv2.COLOR_RGB2HSV).astype(int)
H, Sa, V = hsv[..., 0], hsv[..., 1], hsv[..., 2]
red = (((H <= 10) | (H >= 168)) & (Sa >= 90) & (V >= 90)).astype(np.uint8)
light = ((Sa <= 70) & (V >= 120)).astype(np.uint8)
np.save(f'{out}/red.npy', red); np.save(f'{out}/light.npy', light)
viz = np.full_like(big, 255)
viz[light == 1] = (200, 200, 200)
viz[red == 1] = (220, 30, 30)
Image.fromarray(viz).resize((im.shape[1] * 2, im.shape[0] * 2)).save(f'{out}/masks-{kind}.png')
print(big.shape)
