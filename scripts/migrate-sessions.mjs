#!/usr/bin/env node
// DSH 会话迁移工具：把 sessions/ 迁到新的工作区路径
//
// 背景：
//   DSH 用「编码后的工作区绝对路径」给会话目录命名，例如
//     D:\65383\Documents\dsh  →  --D-65383-Documents-dsh--
//   而且每个 session.v4.jsonl.zstd 的首行还写死了 {"cwd":"D:\\65383\\..."}。
//   所以换机器/换路径后，DSH 会找不到历史会话（目录名和 cwd 都对不上）。
//
// 这个脚本做三件事：
//   1. 按旧路径 → 新路径，重命名 --<旧>-- 目录
//   2. 解压每个 session.v4.jsonl.zstd，把首行 cwd 改掉，再压回去
//   3. 原样保留其它所有文件
//
// 用法：
//   node scripts/migrate-sessions.mjs --from "D:\65383\Documents\dsh" --to "D:\dsh" --src sessions-backup --out sessions-migrated
//
// 参数：
//   --from   旧工作区绝对路径（必填）
//   --to     新工作区绝对路径（必填）
//   --src    输入 sessions 目录（默认 ./sessions-backup）
//   --out    输出目录（默认 ./sessions-migrated，会先清空）
//   --dry    只打印要做什么，不写文件
//
// 注意：先备份再跑。脚本只读 --src，只写 --out。

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

/** 把绝对路径编码成 DSH 的会话目录名：D:\a\b -> --D-a-b-- */
export function encodeWorkspaceDir(absPath) {
  const p = String(absPath).replace(/[\\/]+$/, '');
  // DSH 的编码规则（实测反推）：
  //   "盘符:" + "分隔符" 这一组只产生**一个** '-'，其余分隔符各产生一个 '-'。
  //   D:\65383\Documents\dsh  →  --D-65383-Documents-dsh--
  //   注意 "D:\\" 是两字符，若各替换一次会得到 "D--"，与真实目录名对不上。
  const body = p
    .replace(/^([A-Za-z]):[\\/]/, '$1-')  // "D:\" → "D-"
    .replace(/[:\\/]/g, '-');             // 其余 : \ / → "-"
  return '--' + body + '--';
}

/** 解压 zstd，把首行 cwd 改成新路径，再压回去。返回 { changed, before, after } */
export function rewriteSessionCwd(zstdBuffer, oldCwd, newCwd) {
  const raw = zlib.zstdDecompressSync(zstdBuffer).toString('utf8');
  const lines = raw.split('\n');
  if (!lines.length) return { changed: false, buffer: zstdBuffer };

  let first;
  try {
    first = JSON.parse(lines[0]);
  } catch {
    return { changed: false, buffer: zstdBuffer };
  }
  if (first?.type !== 'session') return { changed: false, buffer: zstdBuffer };
  if (typeof first.cwd !== 'string') return { changed: false, buffer: zstdBuffer };

  const before = first.cwd;
  if (before === newCwd) return { changed: false, buffer: zstdBuffer };
  // 只改写「确实指向旧工作区」的会话。
  // 必须加这一层：sessions/ 里还混着 Temp 目录、其它项目的会话，
  // 无差别改写会把它们也指到新路径，等于破坏无关数据。
  // 用路径前缀比较（不区分分隔符与大小写），保证 D:\old 和 D:\old\sub 都算命中。
  const normPath = (s) => String(s).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const b = normPath(before);
  const o = normPath(oldCwd);
  if (b !== o && !b.startsWith(o + '/')) return { changed: false, buffer: zstdBuffer };

  first.cwd = newCwd;
  lines[0] = JSON.stringify(first);
  const out = zlib.zstdCompressSync(Buffer.from(lines.join('\n'), 'utf8'));
  return { changed: true, buffer: out, before, after: newCwd };
}

function parseArgs(argv) {
  const a = { src: 'sessions-backup', out: 'sessions-migrated', dry: false };
  // 支持 -from X 和 --from X 两种写法。
  // 注意：直接写 `node script --from X` 时，node 会把 --from 当自己的参数报 bad option，
  // 所以推荐单横线 `-from`（node 不会解析它）。
  const keyOf = (s) => String(s).replace(/^-+/, '').toLowerCase();
  for (let i = 2; i < argv.length; i++) {
    const k = keyOf(argv[i]);
    if (k === 'from') a.from = argv[++i];
    else if (k === 'to') a.to = argv[++i];
    else if (k === 'src') a.src = argv[++i];
    else if (k === 'out') a.out = argv[++i];
    else if (k === 'dry') a.dry = true;
  }
  return a;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.from || !args.to) {
    console.error('用法: node scripts/migrate-sessions.mjs -from "<旧路径>" -to "<新路径>" [-src dir] [-out dir] [-dry]');
    console.error('  说明：用单横线 -from；若写成 --from，必须加 -- 分隔：node script -- --from ...');
    process.exit(1);
  }
  const oldDirName = encodeWorkspaceDir(args.from);
  const newDirName = encodeWorkspaceDir(args.to);

  console.log('=== 会话迁移 ===');
  console.log('  旧工作区 :', args.from);
  console.log('  新工作区 :', args.to);
  console.log('  旧目录名 :', oldDirName);
  console.log('  新目录名 :', newDirName);
  console.log('');

  if (!fs.existsSync(args.src)) {
    console.error('输入目录不存在:', args.src);
    process.exit(1);
  }

  const entries = fs.readdirSync(args.src, { withFileTypes: true }).filter((e) => e.isDirectory());
  console.log('发现', entries.length, '个工作区目录');

  let renamedDirs = 0;
  let rewrittenFiles = 0;
  let skippedFiles = 0;
  let copiedFiles = 0;

  if (!args.dry) {
    // 输出目录先清空（避免上次残留混进来）
    if (fs.existsSync(args.out)) fs.rmSync(args.out, { recursive: true, force: true });
    fs.mkdirSync(args.out, { recursive: true });
  }

  for (const ent of entries) {
    const srcDir = path.join(args.src, ent.name);
    // 只重命名「旧工作区」那一个目录；其它工作区的目录原样保留
    // （它们的路径没变，或者用户自己决定怎么处理）
    const targetName = ent.name === oldDirName ? newDirName : ent.name;
    if (ent.name === oldDirName) renamedDirs++;

    const dstDir = path.join(args.out, targetName);
    if (args.dry) {
      console.log('  ' + ent.name + ' → ' + targetName);
    } else {
      fs.mkdirSync(dstDir, { recursive: true });
    }

    // 递归处理该目录下所有文件
    const walk = (dir, rel) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, f.name);
        const relPath = path.join(rel, f.name);
        if (f.isDirectory()) {
          if (!args.dry) fs.mkdirSync(path.join(dstDir, relPath), { recursive: true });
          walk(abs, relPath);
          continue;
        }
        if (f.name.endsWith('.jsonl.zstd')) {
          const buf = fs.readFileSync(abs);
          let result;
          try {
            result = rewriteSessionCwd(buf, args.from, args.to);
          } catch (e) {
            console.log('    ! 解压失败，原样复制:', relPath, '—', e.message);
            if (!args.dry) fs.writeFileSync(path.join(dstDir, relPath), buf);
            skippedFiles++;
            continue;
          }
          if (result.changed) {
            rewrittenFiles++;
            if (args.dry) console.log('    cwd 改写:', relPath, ':', result.before, '→', result.after);
          }
          if (!args.dry) fs.writeFileSync(path.join(dstDir, relPath), result.buffer);
        } else {
          copiedFiles++;
          if (!args.dry) fs.copyFileSync(abs, path.join(dstDir, relPath));
        }
      }
    };
    walk(srcDir, '');
  }

  console.log('');
  console.log('=== 结果 ===');
  console.log('  重命名目录  :', renamedDirs);
  console.log('  改写 cwd 文件:', rewrittenFiles);
  console.log('  原样复制文件 :', copiedFiles);
  if (skippedFiles) console.log('  跳过(解压失败):', skippedFiles);
  if (args.dry) {
    console.log('');
    console.log('(dry run，未写任何文件)');
  } else {
    console.log('');
    console.log('输出目录:', path.resolve(args.out));
    console.log('');
    console.log('下一步：把输出目录内容拷到新机器的 ~/.dsh/sessions/');
  }
}

// 只有直接运行时才执行 main（作为模块导入时只导出函数，方便测试）。
// 不能用 argv[1].endsWith(...) 判断 —— 测试文件 import 本模块时会被误判成「直接运行」，
// 于是 main() 在测试里跑起来、参数为空、直接报错退出。改成比较解析后的绝对路径。
// 判断「是不是直接运行」。Windows 上 path.resolve 和 fileURLToPath 的结果
// 可能只差分隔符或大小写，直接 === 容易失败（实测 main 根本不跑）。
// 改用「规范化后比较 + 兜底看有没有命令行参数」：
//   · 测试文件 import 本模块时，不会传 --from/--to，所以兜底条件也不成立。
const __isMain = (() => {
  try {
    const self = fileURLToPath(import.meta.url);
    const argv = process.argv[1] ? path.resolve(process.argv[1]) : '';
    if (!self || !argv) return false;
    const norm = (s) => s.replace(/\\/g, '/').toLowerCase();
    if (norm(self) === norm(argv)) return true;
    // 兜底：文件名一致 + 传了本工具的专用参数 → 认为是被直接调用
    const sameName = path.basename(self).toLowerCase() === path.basename(argv).toLowerCase();
    const hasFlag = process.argv.slice(2).some((a) => a === '--from' || a === '--to' || a === '--dry');
    return sameName && hasFlag;
  } catch {
    return false;
  }
})();
if (__isMain) main();

export { parseArgs };
