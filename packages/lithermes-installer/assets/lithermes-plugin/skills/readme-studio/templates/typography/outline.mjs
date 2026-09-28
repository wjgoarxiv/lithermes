import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {create} from 'fontkit';

function safeParents(file) {
  for (let p = path.resolve(file);; p = path.dirname(p)) {
    if (fs.lstatSync(p).isSymbolicLink()) throw new Error('symlink path refused');
    if (p === path.dirname(p)) break;
  }
}
function readBounded(file, max) {
  safeParents(file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size < 1 || st.size > max) throw new Error('input must be a bounded regular file');
    const bytes = Buffer.alloc(st.size);
    let offset = 0;
    while (offset < bytes.length) {
      const n = fs.readSync(fd, bytes, offset, bytes.length-offset, offset);
      if (!n) throw new Error('input changed while reading');
      offset += n;
    }
    const after = fs.fstatSync(fd);
    if (after.size !== st.size || after.mtimeMs !== st.mtimeMs || after.ctimeMs !== st.ctimeMs) throw new Error('input changed while reading');
    return bytes;
  } finally { fs.closeSync(fd); }
}
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
try {
  const args = new Map();
  const names = ['--font','--license','--family','--text','--fill','--output-root','--output'];
  for (let i=2;i<process.argv.length;i+=2) {
    const key=process.argv[i], value=process.argv[i+1];
    if (!names.includes(key) || value === undefined || args.has(key)) throw new Error('invalid arguments');
    args.set(key,value);
  }
  if (names.some((key)=>!args.has(key))) throw new Error('font, license, family, text, fill, output-root and output are required');
  const text=args.get('--text'), fill=args.get('--fill');
  if (!text.trim() || [...text].length > 500 || /[\x00-\x1f\x7f]/.test(text)) throw new Error('invalid text');
  if (!/^#[a-f\d]{6}$/i.test(fill)) throw new Error('fill must be six-digit hex');
  const bytes=readBounded(args.get('--font'),32*1024*1024);
  const notice=readBounded(args.get('--license'),1024*1024);
  const font=create(bytes);
  const normalize=(x)=>String(x).toLowerCase().replace(/[^a-z0-9]/g,'');
  const expected=normalize(args.get('--family'));
  if (!['pretendard','meslolgsnf'].includes(expected) || !normalize(font.familyName).includes(expected)) throw new Error('font identity mismatch');
  if ([...text].some((c)=>!font.hasGlyphForCodePoint(c.codePointAt(0)))) throw new Error('missing glyph');
  const run=font.layout(text);
  let x=0,y=0,minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  const paths=[];
  for (let i=0;i<run.glyphs.length;i++) {
    const glyph=run.glyphs[i], pos=run.positions[i];
    if (!glyph.id) throw new Error('missing shaped glyph');
    const gx=x+pos.xOffset, gy=y+pos.yOffset;
    if (glyph.path.commands.length) {
      const b=glyph.bbox;
      minX=Math.min(minX,gx+b.minX); maxX=Math.max(maxX,gx+b.maxX);
      minY=Math.min(minY,gy+b.minY); maxY=Math.max(maxY,gy+b.maxY);
      paths.push(`<path transform="translate(${gx} ${-gy}) scale(1 -1)" d="${glyph.path.toSVG()}"/>`);
    }
    x+=pos.xAdvance; y+=pos.yAdvance;
  }
  if (!paths.length || ![minX,minY,maxX,maxY].every(Number.isFinite)) throw new Error('no finite outlines');
  const pad=font.unitsPerEm*0.04, width=maxX-minX+2*pad, height=maxY-minY+2*pad;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX-pad} ${-maxY-pad} ${width} ${height}" width="${width}" height="${height}" fill="${fill}">${paths.join('')}</svg>\n`;
  const root=path.resolve(args.get('--output-root')), relative=args.get('--output');
  safeParents(root);
  if (!fs.statSync(root).isDirectory() || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some((x)=>!x||x==='.'||x==='..') || !relative.endsWith('.svg')) throw new Error('unsafe output');
  const output=path.join(root,relative);
  safeParents(path.dirname(output));
  const fd=fs.openSync(output,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o644);
  try { fs.writeFileSync(fd,svg); } finally {fs.closeSync(fd);}
  console.log(JSON.stringify({text,family:font.familyName,postscript:font.postscriptName,font_sha256:sha(bytes),license_sha256:sha(notice),license_review:'required separately',glyphs:run.glyphs.length,width,height,fill,output,svg_sha256:sha(svg)}));
} catch(error) {
  console.error(`OUTLINE_BLOCKED: ${error.message}`);
  process.exitCode=1;
}
