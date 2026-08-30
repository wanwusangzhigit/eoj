import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, '..', 'dist');
const dstDir = path.join(__dirname, '..', '..', 'backend', 'public');

// 清空目标目录
fs.rmSync(dstDir, { recursive: true, force: true });
fs.mkdirSync(dstDir, { recursive: true });

// 递归复制
function copyDir(src) {
  for (const entry of fs.readdirSync(src)) {
    const srcPath = path.join(src, entry);
    const relPath = path.relative(srcDir, srcPath);
    const dstPath = path.join(dstDir, relPath);

    if (fs.statSync(srcPath).isDirectory()) {
      fs.mkdirSync(dstPath, { recursive: true });
      copyDir(srcPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

copyDir(srcDir);

// 统计文件数
let count = 0;
function countFiles(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (fs.statSync(p).isDirectory()) {
      countFiles(p);
    } else {
      count++;
    }
  }
}
countFiles(dstDir);

console.log(`Frontend built and copied to backend/public (${count} files)`);
