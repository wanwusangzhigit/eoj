import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, '..', 'dist');
const dstDir = path.join(__dirname, '..', '..', 'backend', 'public');
const serverSrcDir = path.join(srcDir, 'server');
const serverDstDir = path.join(__dirname, '..', '..', 'backend', 'ssr');

// 清空目标目录(public: 客户端静态资源)
fs.rmSync(dstDir, { recursive: true, force: true });
fs.mkdirSync(dstDir, { recursive: true });

// 清空并准备服务端 bundle 目录(backend/ssr: SSR server bundle)
fs.rmSync(serverDstDir, { recursive: true, force: true });
fs.mkdirSync(serverDstDir, { recursive: true });

// 递归复制
function copyDir(src, dstRoot, srcRoot) {
  for (const entry of fs.readdirSync(src)) {
    const srcPath = path.join(src, entry);
    const relPath = path.relative(srcRoot, srcPath);
    const dstPath = path.join(dstRoot, relPath);

    if (fs.statSync(srcPath).isDirectory()) {
      fs.mkdirSync(dstPath, { recursive: true });
      copyDir(srcPath, dstRoot, srcRoot);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

// 复制客户端产物到 backend/public
copyDir(srcDir, dstDir, srcDir);

// 复制服务端 bundle 到 backend/ssr(跳过 server 目录本身,避免嵌套)
if (fs.existsSync(serverSrcDir)) {
  copyDir(serverSrcDir, serverDstDir, serverSrcDir);
}

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

let serverCount = 0;
if (fs.existsSync(serverDstDir)) {
  const countServerFiles = (dir) => {
    for (const entry of fs.readdirSync(dir)) {
      const p = path.join(dir, entry);
      if (fs.statSync(p).isDirectory()) {
        countServerFiles(p);
      } else {
        serverCount++;
      }
    }
  };
  countServerFiles(serverDstDir);
}

console.log(`Frontend built and copied to backend/public (${count} files)`);
console.log(`SSR server bundle copied to backend/ssr (${serverCount} files)`);
