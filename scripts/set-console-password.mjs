// 设置控制台访问密码（写入 config.json 的 console.auth，明文不落盘）
//
// 用法：
//   node scripts/set-console-password.mjs
//   node scripts/set-console-password.mjs "你的密码"
//
// 不带参数时会交互式提示输入（推荐：避免密码留在命令历史里）。
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { hashPassword, validatePasswordStrength } from '../src/console-auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONFIG = path.join(ROOT, 'config.json');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
}

async function main() {
  let pwd = process.argv[2];
  if (!pwd) {
    pwd = await ask('请输入控制台访问密码：');
    if (!pwd) {
      console.error('密码不能为空');
      process.exit(1);
    }
    const again = await ask('再输一次确认：');
    if (again !== pwd) {
      console.error('两次输入不一致');
      process.exit(1);
    }
  }

  const check = validatePasswordStrength(pwd);
  if (!check.ok) {
    console.error('密码不合格：' + check.reason);
    process.exit(1);
  }

  const stored = hashPassword(pwd);
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  } catch (e) {
    console.error('读取 config.json 失败：' + e.message);
    process.exit(1);
  }
  if (!cfg.console || typeof cfg.console !== 'object') cfg.console = {};
  if (!cfg.console.auth || typeof cfg.console.auth !== 'object') cfg.console.auth = {};
  cfg.console.auth.salt = stored.salt;
  cfg.console.auth.hash = stored.hash;
  // 换密码时同时轮换会话密钥 → 让所有旧会话立即失效
  cfg.console.auth.sessionSecret = (await import('node:crypto')).randomBytes(32).toString('hex');
  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n', 'utf8');

  console.log('');
  console.log('✓ 控制台密码已设置');
  console.log('  访问地址：https://qb.example.com/admin/');
  console.log('  用密码登录后，浏览器会记住 7 天，不用每次输。');
  console.log('');
  console.log('⚠️ 需要重启桥接才生效。');
  console.log('⚠️ 换密码会让所有已登录的浏览器失效（会话密钥已轮换）。');
}

main().catch((e) => { console.error(e); process.exit(1); });
