// node look.mjs in.png out.jpg [width]  (downscale for viewing)
import sharp from 'sharp';
await sharp(process.argv[2]).resize({ width: +(process.argv[4] || 1800) }).jpeg({ quality: 85 }).toFile(process.argv[3]);
