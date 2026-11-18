import sharp from 'sharp'; import fs from 'node:fs';
const jobs = JSON.parse(process.argv[2]);
for (const [src, dst, w] of jobs) {
  let im = sharp(src); if (w) im = im.resize(w);
  await im.png().toFile(dst + '.png'); await sharp(src).resize(w||undefined).jpeg({ quality: 90 }).toFile(dst + '.jpg');
}
