import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

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

// 服务端 bundle 后处理
// 两个在 Cloudflare Workers 下必须处理的问题:
//
// 1) Wrangler 会把 SSR 单文件 bundle 再次打包内联进 worker 的 index.js,此时
//    Vite 生成的 `createRequire(import.meta.url)` 中 import.meta.url 会被 esbuild
//    置为 undefined,导致 createRequire(undefined) 抛错。因此把 import.meta.url
//    替换为 SSR 入口在磁盘上的真实绝对 file:// 路径,给 createRequire 一个合法基准。
//
// 2) react-dom/server(React 19)的 CJS 构建在模块加载时会 require 一批 Node 内置
//    模块(util/crypto/stream/events/buffer/async_hooks...)。这些调用通过
//    createRequire 返回的 require 函数执行:require("util") 之类。Wrangler 的
//    nodejs_compat 不识别"裸名"作为内置,会按相对路径解析而失败;必须在运行时改为
//    require("node:util") 的 node: 前缀形式,nodejs_compat 才能解析为内置模块。
//    由于本项目使用 renderToReadableStream(Web 流),这些 Node 支撑只在模块加载时
//    被 require,不会真正被调用,改成 node: 前缀(解析为空 stub)即可安全启动。
//
// 因此这里做两步后处理:替换 createRequire(import.meta.url);把 createRequire 别名
// 对内部 -- 我们只对"require 别名接收裸内置名"的调用精确改写 -- 核心模块名统一加 node:。
const WORKER_NODE_CORE = [
  'util', 'stream', 'buffer', 'crypto', 'events', 'async_hooks', 'path', 'fs',
  'os', 'url', 'zlib', 'http', 'https', 'tls', 'net', 'timers', 'module',
  'assert', 'string_decoder', 'querystring', 'process', 'child_process',
  'diagnostics_channel', 'worker_threads', 'dns', 'http2', 'readline',
  'perf_hooks', 'vm', 'wasi', 'punycode', 'console', 'constants', 'domain',
];

if (fs.existsSync(serverDstDir)) {
  const entryFile = path.join(serverDstDir, 'entry-server.js');
  const requireBaseUrl = pathToFileURL(entryFile).href;
  for (const entry of fs.readdirSync(serverDstDir)) {
    const p = path.join(serverDstDir, entry);
    if (fs.statSync(p).isFile() && p.endsWith('.js')) {
      let content = fs.readFileSync(p, 'utf-8');
      const changes = [];
      // 1. 提取 createRequire 别名:`import { createRequire as Alias }from"node:module"`
      const aliasPattern = /import\s*\{[^}]*createRequire\s+as\s+([A-Za-z_$][\w$]*)\s*}/;
      const aliasMatch = content.match(aliasPattern);
      if (aliasMatch) {
        const alias = aliasMatch[1];
        // 1a. 替换 createRequire(import.meta.url) -> createRequire(<真实 file url>)
        const metaRe = new RegExp(
          alias + '\\s*\\(\\s*import\\.meta\\.url\\s*\\)',
          'g'
        );
        if (metaRe.test(content)) {
          content = content.replace(metaRe, `${alias}(${JSON.stringify(requireBaseUrl)})`);
          changes.push(`createRequire(import.meta.url)->${requireBaseUrl}`);
        }
// 1b. 把 react-dom 等对裸内置名的 require 改成 node: 前缀:
        //     require("util") -> require("node:util")。
        //     这里只匹配 `("core")` 调用形态,经实证该 bundle 中这种形态仅出现在
        //     react-dom 的 require 调用(util/stream/crypto/buffer/events/async_hooks),
        //     不会误伤 i18n key / JSX / 属性名,故直接用字符串替换最安全。
        for (const core of WORKER_NODE_CORE) {
          const fromToken = `("${core}")`;
          const toToken = `("node:${core}")`;
          if (content.includes(fromToken)) {
            // 用分割-合并做全文替换,避免带 g 标志正则的 lastIndex 状态问题
            content = content.split(fromToken).join(toToken);
            changes.push(`${core}->node:${core}`);
          }
        }
      }
      if (changes.length > 0) {
        fs.writeFileSync(p, content, 'utf-8');
        console.log(`SSR post-patch (${relNameFor(p)}): ${changes.join(', ')}`);
      }
    }
  }
}

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

function relNameFor(p) {
  return path.relative(serverDstDir, p);
}

console.log(`Frontend built and copied to backend/public (${count} files)`);
console.log(`SSR server bundle copied to backend/ssr (${serverCount} files)`);
