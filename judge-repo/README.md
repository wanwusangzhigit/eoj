# EOJ Judge Engine (nsjail edition)

Production-grade sandboxed judge engine for EOJ, powered by **nsjail** + **seccomp-bpf** + **cgroups v2**.

## Security Architecture

| Layer | Mechanism | What it blocks |
|-------|-----------|----------------|
| Namespace | PID, Net, Mount, IPC, UTS, User | Process escape, network access, host FS visibility |
| Seccomp | **Whitelist** `DEFAULT TRAP` | Any syscall not explicitly allowed triggers **SIGSYS (exit 159)**. This includes `socket`, `connect`, `execve` (runtime), `ptrace`, `mount`, `chroot`, `setuid`, `bpf`, etc. |
| Cgroup v2 | memory / cpu / pids hard limits | OOM killer, CPU throttling, fork bombs |
| Rlimit | AS / CPU / NOFILE / NPROC / FSIZE | Additional resource guards |
| FS | Read-only system bind-mounts | Only `/box` and `/tmp` are writable |
| Identity | UID 65534 (nobody) | Zero privileges inside the sandbox |

### Why this blocks "dangerous commands" reliably

**No command blacklist is used.** Blacklists are trivially bypassed via:
- Macro expansion (`#define SYSTEM system`)
- String concatenation (`"sy"+"stem"`)
- Obfuscated shellcode

Instead, we use a **seccomp-bpf syscall whitelist**. No matter how you obfuscate the call in source code, the CPU must eventually execute the `syscall` instruction. If that syscall number is not on the whitelist, the kernel sends **SIGSYS** immediately. This is enforced by the kernel, not by string parsing.

## Backend Compatibility

The EOJ backend (`internal.ts`) only accepts these submission statuses:

```
accepted, wrong_answer, time_limit_exceeded, memory_limit_exceeded,
runtime_error, compile_error, system_error, security_blocked
```

This judge engine maps internal statuses to backend-compatible ones:

| Internal Status | Backend Status | Preserved in |
|-----------------|----------------|------------|
| `accepted` | `accepted` | — |
| `wrong_answer` | `wrong_answer` | — |
| `time_limit_exceeded` | `time_limit_exceeded` | — |
| `memory_limit_exceeded` | `memory_limit_exceeded` | — |
| `runtime_error` | `runtime_error` | — |
| `compile_error` | `compile_error` | — |
| `system_error` | `system_error` | — |
| `dangerous_operation` | `security_blocked` | testcase message + judge logs |
| `output_limit_exceeded` | `wrong_answer` | testcase message + judge logs |

The **real status** is always preserved in:
1. **Testcase detail message** — visible to users in the frontend submission detail page
2. **Judge logs** — stored in the `judge_logs` table, accessible via `/api/v1/submissions/:id/logs`
3. **GitHub Actions stdout** — visible in the GitHub Actions run log

## Supported Languages

- **C** (`gcc`)
- **C++** (`g++ -std=c++17`)
- **Python 3** (`python3`)
- **Java** (`javac` + `java`)
- **JavaScript** (`node`)
- **Go** (`go build`)
- **Rust** (`rustc`)

## File Structure

```
judge-repo/
├── .github/workflows/judge.yml   # GitHub Actions workflow
├── config/
│   ├── nsjail_compile.cfg        # Compile sandbox (allows execve for toolchain)
│   └── nsjail_run.cfg            # Run sandbox (forbids execve, socket, mount, ptrace...)
├── docker/
│   └── Dockerfile                # Optional pre-built toolchain image
├── scripts/
│   └── judge.sh                  # Main judge controller
└── submissions/
    └── .gitkeep
```

## Deployment

### Option A: Direct install on runner (default)
The provided `judge.yml` installs `nsjail` and all compilers directly on the `ubuntu-latest` runner via `apt-get`. No Docker image caching is required.

### Option B: Pre-built container (faster)
Build and push the Dockerfile to GHCR:

```bash
cd judge-repo/docker
docker build -t ghcr.io/YOURNAME/eoj-nsjail:latest .
docker push ghcr.io/YOURNAME/eoj-nsjail:latest
```

Then modify `judge.yml` to use it:

```yaml
jobs:
  judge:
    runs-on: ubuntu-latest
    container:
      image: ghcr.io/YOURNAME/eoj-nsjail:latest
    ...
```
