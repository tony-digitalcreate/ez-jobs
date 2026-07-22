// one-off: renders the EZ JOBS icon (white thunder bolt on blue gradient, Tony-profile palette) at all sizes
const sharp = require(String.raw`C:\Users\Hp By Comcom\Claude Code\ez-convert\node_modules\sharp`);
const path = require('path');

const svg = (s) => Buffer.from(`
<svg width="${s}" height="${s}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#52dcff"/>
      <stop offset="40%" stop-color="#229dff"/>
      <stop offset="72%" stop-color="#4169e1"/>
      <stop offset="100%" stop-color="#756cff"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="110" fill="url(#g)"/>
  <path d="M300 40 L140 288 L236 288 L204 472 L376 208 L272 208 Z"
        fill="#ffffff" stroke="#dbf3ff" stroke-width="8" stroke-linejoin="round"/>
</svg>`);

(async () => {
  const out = path.join(__dirname, 'docs');
  for (const s of [512, 192, 32]) {
    await sharp(svg(s)).resize(s, s).png().toFile(path.join(out, `icon-${s}.png`));
  }
  console.log('icons done');
})();
