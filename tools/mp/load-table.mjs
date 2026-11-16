// Plain-Node loader of a map's placement file (= the server's object table): gunzip + parse with the Worker's own parser. No browser needed.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { parseTable } from '../../worker/mp/table.js';
import { fileOf } from './fingerprint.mjs';

export function readTableBytes(slug = 'centrs') {
  const raw = fs.readFileSync(fileOf(slug));
  const b = raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw;
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
export const loadTable = (slug = 'centrs') => parseTable(readTableBytes(slug));
