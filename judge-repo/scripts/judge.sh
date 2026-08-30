#!/bin/bash
# EOJ Sandboxed Judge Controller (nsjail edition)
#
# Security model — untrusted user code NEVER runs bare-metal on the host.
# Every submission (compile + run) executes inside a hardened nsjail sandbox:
# 1. Linux namespaces (pid, net, mount, ipc, uts, user)  → full isolation
# 2. seccomp-bpf WHITELIST (DEFAULT TRAP)                → any non-whitelisted
#    syscall triggers SIGSYS (exit 159), reported as dangerous_operation.
#    IMMUNE to string concatenation / macro obfuscation.
# 3. cgroup v2 hard limits (memory, CPU, PIDs)           → OOM / fork-bomb protection
# 4. rlimit extra guards (address space, file size, nproc)
# 5. read-only system bind-mounts + writable box/tmp     → FS containment
# 6. User 65534 (nobody) inside the sandbox              → zero privileges
# 7. No network devices / blocked net syscalls           → air-gapped
#
# BACKEND COMPATIBILITY:
# The backend (internal.ts) only accepts these statuses:
#   accepted, wrong_answer, time_limit_exceeded, memory_limit_exceeded,
#   runtime_error, compile_error, system_error, security_blocked
# Any other status causes a 400 Bad Request.
# Therefore we map:
#   dangerous_operation  → security_blocked  (backend supports this)
#   output_limit_exceeded → wrong_answer     (backend does NOT support this)
# The REAL status is preserved in:
#   - testcase detail message (visible to user in frontend)
#   - judge logs (stored in judge_logs table via the logs field)
#   - stdout of this script (visible in GitHub Actions logs)
#
# Output contract: writes result.json to CWD.
set -u

PY="python3"
if ! "$PY" -c "print(1)" >/dev/null 2>&1; then
    PY="python"
fi

SUBMISSION_ID="${SUBMISSION_ID:-}"
LANGUAGE="${LANGUAGE:-}"
SOURCE_FILE="${SOURCE_FILE:-}"
JUDGE_DATA="${JUDGE_DATA:-judge_data.json}"
JUDGE_DATA="${JUDGE_DATA//\$HOME/$HOME}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NSJAIL_COMPILE_CFG="$REPO_ROOT/config/nsjail_compile.cfg"
NSJAIL_RUN_CFG="$REPO_ROOT/config/nsjail_run.cfg"

NSJAIL_BIN=$(command -v nsjail)
if [ -z "$NSJAIL_BIN" ]; then
    echo '{"submission_id":"'"$SUBMISSION_ID"'","status":"system_error","details":[{"status":"system_error","message":"nsjail binary not found in PATH"}]}' > result.json
    exit 0
fi

if [ "$(id -u)" -eq 0 ]; then
    SUDO=""
else
    SUDO="sudo"
fi

# ---------------- helpers ----------------
json_get() {
    "$PY" -c "
import json,sys
d=json.load(open('$JUDGE_DATA'))
inner=d.get('data',d)
print($1)
" 2>/dev/null
}

fail_json() {
    "$PY" - "$SUBMISSION_ID" "$1" "$2" <<'PY'
import json, sys
sid, status, msg = sys.argv[1], sys.argv[2], sys.argv[3]
print(json.dumps({"submission_id": sid, "status": status,
 "details": [{"status": status, "message": msg}]}, ensure_ascii=False))
PY
}

# ---------------- parse judge data ----------------
TIME_LIMIT=$(json_get "inner.get('problem',{}).get('time_limit',1000)")
MEMORY_LIMIT=$(json_get "inner.get('problem',{}).get('memory_limit',256)")
N_CASES=$(json_get "len(inner.get('testcases',[]))")
JUDGE_TYPE=$(json_get "inner.get('problem',{}).get('judge_type','default')")
SPJ_LANG=$(json_get "inner.get('problem',{}).get('spj_language','')")
SPJ_CODE=$(json_get "inner.get('problem',{}).get('spj_code','')")
ACTION_TIMEOUT=$(json_get "inner.get('action_timeout', 300)")

if ! [ "$ACTION_TIMEOUT" -ge 1 ] 2>/dev/null; then
    ACTION_TIMEOUT=300
fi

echo "[JUDGE] Config: time_limit=${TIME_LIMIT}ms, memory_limit=${MEMORY_LIMIT}MB, testcases=${N_CASES}, judge_type=${JUDGE_TYPE}"
echo "[JUDGE] Submission: id=${SUBMISSION_ID}, language=${LANGUAGE}, file=${SOURCE_FILE}"

if [ -z "$TIME_LIMIT" ] || [ -z "$MEMORY_LIMIT" ] || [ -z "$N_CASES" ]; then
    fail_json system_error "Failed to parse judge data from $JUDGE_DATA" > result.json
    exit 0
fi

# ---------------- prepare workdir ----------------
WORK_DIR="/tmp/judge_${SUBMISSION_ID}"
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR/box" "$WORK_DIR/inputs" "$WORK_DIR/outputs" "$WORK_DIR/expected" "$WORK_DIR/cases" "$WORK_DIR/tmp"
chmod 777 "$WORK_DIR/box" "$WORK_DIR/outputs" "$WORK_DIR/cases" "$WORK_DIR/tmp"
chmod 755 "$WORK_DIR/inputs" "$WORK_DIR/expected"

SOURCE_EXT="${SOURCE_FILE##*.}"
[ "$SOURCE_EXT" = "$SOURCE_FILE" ] && SOURCE_EXT=""
SOURCE_FILENAME="solution${SOURCE_EXT:+.$SOURCE_EXT}"
cp "$SOURCE_FILE" "$WORK_DIR/box/$SOURCE_FILENAME"

for i in $(seq 0 $((N_CASES - 1))); do
    json_get "inner['testcases'][$i]['input']" > "$WORK_DIR/inputs/$i.txt"
    json_get "inner['testcases'][$i]['expected_output']" > "$WORK_DIR/expected/$i.txt"
done
chmod -R a+r "$WORK_DIR/inputs"

# ---------------- language-specific commands ----------------
COMPILE_CMD=""
RUN_ARGS=()
case "$LANGUAGE" in
    python)
        COMPILE_CMD=""
        RUN_ARGS=(/usr/bin/python3 -B "/box/$SOURCE_FILENAME")
        ;;
    cpp)
        COMPILE_CMD="g++ -std=c++17 -O2 -o /box/solution_bin /box/$SOURCE_FILENAME"
        RUN_ARGS=("/box/solution_bin")
        ;;
    java)
        cp "$SOURCE_FILE" "$WORK_DIR/box/Main.java"
        COMPILE_CMD="javac /box/Main.java"
        JAVA_HEAP_LIMIT=$((MEMORY_LIMIT - 64))
        [ "$JAVA_HEAP_LIMIT" -lt 32 ] && JAVA_HEAP_LIMIT=32
        RUN_ARGS=(/usr/bin/java "-Xmx${JAVA_HEAP_LIMIT}m" "-Xms32m" -XX:+UseSerialGC -cp /box Main)
        ;;
    javascript)
        COMPILE_CMD=""
        RUN_ARGS=(/usr/bin/node "/box/$SOURCE_FILENAME")
        ;;
    c)
        COMPILE_CMD="gcc -std=c11 -O2 -o /box/solution_bin /box/$SOURCE_FILENAME"
        RUN_ARGS=("/box/solution_bin")
        ;;
    go)
        cp "$SOURCE_FILE" "$WORK_DIR/box/main.go"
        COMPILE_CMD="GOCACHE=/tmp/gocache GOFLAGS=-buildvcs=false go build -o /box/solution_bin /box/main.go"
        RUN_ARGS=("/box/solution_bin")
        ;;
    rust)
        cp "$SOURCE_FILE" "$WORK_DIR/box/main.rs"
        COMPILE_CMD="rustc -O -o /box/solution_bin /box/main.rs"
        RUN_ARGS=("/box/solution_bin")
        ;;
    *)
        fail_json system_error "Unsupported language: $LANGUAGE" > result.json
        exit 0
        ;;
esac

TL_SEC=$((TIME_LIMIT / 1000 + 1))
COMPILE_TIMEOUT="${COMPILE_TIMEOUT:-60}"
COMPILE_MEM_MB=$((MEMORY_LIMIT + 512))
MAX_OUTPUT_BYTES=65536

# ---------------- compile phase ----------------
if [ -n "$COMPILE_CMD" ]; then
    echo "[JUDGE] Compiling: $COMPILE_CMD"

    COMPILE_START=$(date +%s%N)

    $SUDO "$NSJAIL_BIN" \
        --quiet \
        --config "$NSJAIL_COMPILE_CFG" \
        --bindmount "$WORK_DIR/box:/box:rw" \
        --bindmount "$WORK_DIR/tmp:/tmp:rw" \
        --bindmount "$WORK_DIR/outputs:/outputs:rw" \
        --rlimit_as ${COMPILE_MEM_MB} \
        --rlimit_cpu ${COMPILE_TIMEOUT} \
        --rlimit_nofile 128 \
        --rlimit_nproc 128 \
        --rlimit_fsize 1048576 \
        --time_limit ${COMPILE_TIMEOUT} \
        --max_cpus 2 \
        -- \
        /bin/bash -c "$COMPILE_CMD" \
        > "$WORK_DIR/outputs/compile_out.txt" 2>&1

    COMPILE_RC=$?
    COMPILE_END=$(date +%s%N)
    COMPILE_MS=$(( (COMPILE_END - COMPILE_START) / 1000000 ))

    if [ $COMPILE_RC -ne 0 ]; then
        echo "[JUDGE] Compile failed with rc=$COMPILE_RC, ${COMPILE_MS}ms"
        if [ $COMPILE_RC -eq 159 ]; then
            # dangerous_operation during compile → security_blocked
            echo "[JUDGE] REAL STATUS: dangerous_operation (forbidden syscall during compilation)"
            fail_json security_blocked "Compilation blocked: forbidden system call detected (security violation). Macro expansion and string concatenation cannot bypass kernel-level seccomp filtering." > result.json
        elif [ $COMPILE_RC -eq 137 ] || [ $COMPILE_RC -eq 9 ]; then
            if [ "$COMPILE_MS" -ge "$((COMPILE_TIMEOUT * 1000 * 90 / 100))" ]; then
                fail_json compile_error "Compilation time limit exceeded (${COMPILE_TIMEOUT}s)" > result.json
            else
                fail_json compile_error "Compilation killed (possibly out of memory)" > result.json
            fi
        else
            COMPILE_ERR=$(head -c 2000 "$WORK_DIR/outputs/compile_out.txt")
            echo "{\"submission_id\":\"$SUBMISSION_ID\",\"status\":\"compile_error\",\"details\":[{\"status\":\"compile_error\",\"message\":$(echo "$COMPILE_ERR" | "$PY" -c 'import sys,json; print(json.dumps(sys.stdin.read()))')}]}" > result.json
        fi
        exit 0
    fi
    echo "[JUDGE] Compilation OK (${COMPILE_MS}ms)"
fi

# ---------------- run test cases ----------------
for i in $(seq 0 $((N_CASES - 1))); do
    SCORE=$(json_get "inner['testcases'][$i].get('score',10)")
    IS_SAMPLE=$(json_get "json.dumps(inner['testcases'][$i].get('is_sample',0))")

    echo "[JUDGE] Running testcase $((i+1))/$N_CASES..."

    START_NS=$(date +%s%N)

    $SUDO "$NSJAIL_BIN" \
        --quiet \
        --config "$NSJAIL_RUN_CFG" \
        --bindmount "$WORK_DIR/box:/box:rw" \
        --bindmount "$WORK_DIR/inputs:/inputs:ro" \
        --bindmount "$WORK_DIR/outputs:/outputs:rw" \
        --bindmount "$WORK_DIR/tmp:/tmp:rw" \
        --rlimit_as $((MEMORY_LIMIT * 2)) \
        --rlimit_cpu ${TL_SEC} \
        --rlimit_nofile 32 \
        --rlimit_nproc 64 \
        --rlimit_fsize 1048576 \
        --time_limit ${TL_SEC} \
        --max_cpus 1 \
        -- \
        "${RUN_ARGS[@]}" \
        < "$WORK_DIR/inputs/$i.txt" \
        > "$WORK_DIR/outputs/$i.txt" \
        2> "$WORK_DIR/outputs/$i.err" \
        &
    NSJAIL_PID=$!

    # Memory monitor: poll all descendant PIDs via /proc for peak RSS (VmHWM)
    (
        MAX_RSS=0
        while kill -0 "$NSJAIL_PID" 2>/dev/null; do
            for pid in $(pgrep -P "$NSJAIL_PID" 2>/dev/null); do
                if [ -f "/proc/$pid/status" ]; then
                    RSS=$(grep '^VmHWM:' "/proc/$pid/status" 2>/dev/null | awk '{print $2}')
                    if [ -n "$RSS" ] && [ "$RSS" -gt "$MAX_RSS" ]; then
                        MAX_RSS=$RSS
                    fi
                fi
            done
            sleep 0.05
        done
        echo "$MAX_RSS" > "$WORK_DIR/outputs/$i.mem"
    ) &
    MONITOR_PID=$!

    wait "$NSJAIL_PID"
    RC=$?
    wait "$MONITOR_PID" 2>/dev/null

    END_NS=$(date +%s%N)
    ELAPSED_MS=$(( (END_NS - START_NS) / 1000000 ))

    MEMORY_KB=$(cat "$WORK_DIR/outputs/$i.mem" 2>/dev/null || echo 0)
    MEMORY_USED=$((MEMORY_KB / 1024))

    TC_STATUS=""
    TC_MESSAGE=""
    TC_SCORE=0

    # Exit-code → verdict mapping
    case $RC in
        0)
            TC_STATUS="pending"
            ;;
        137|9)
            if [ "$ELAPSED_MS" -ge "$((TIME_LIMIT * 90 / 100))" ]; then
                TC_STATUS="time_limit_exceeded"
                TC_MESSAGE="Time limit exceeded (${ELAPSED_MS}ms > ${TIME_LIMIT}ms)"
            else
                TC_STATUS="memory_limit_exceeded"
                TC_MESSAGE="Memory limit exceeded (cgroup OOM killed the process)"
            fi
            ;;
        134)
            TC_STATUS="runtime_error"
            TC_MESSAGE="Aborted (SIGABRT)"
            ;;
        139)
            TC_STATUS="runtime_error"
            TC_MESSAGE="Segmentation fault (SIGSEGV)"
            ;;
        136)
            TC_STATUS="runtime_error"
            TC_MESSAGE="Floating point exception (SIGFPE)"
            ;;
        132)
            TC_STATUS="runtime_error"
            TC_MESSAGE="Illegal instruction (SIGILL)"
            ;;
        159)
            TC_STATUS="dangerous_operation"
            TC_MESSAGE="Forbidden system call detected (security violation). Your code attempted to invoke a disallowed kernel function (e.g., network access, process creation, or privileged operation). This has been intercepted at the kernel level via seccomp-bpf and cannot be bypassed by string concatenation or macro definitions."
            ;;
        1)
            if [ "$JUDGE_TYPE" = "spj" ]; then
                TC_STATUS="pending_spj"
            else
                TC_STATUS="runtime_error"
                TC_MESSAGE="Runtime error (exit code 1)"
            fi
            ;;
        *)
            TC_STATUS="runtime_error"
            TC_MESSAGE="Runtime error (exit code $RC)"
            ;;
    esac

    # If already a definitive non-AC status, record and continue
    if [ "$TC_STATUS" != "pending" ] && [ "$TC_STATUS" != "pending_spj" ]; then
        TC_SCORE=0
        "$PY" - "$WORK_DIR/outputs/meta_$i.json" "$TC_STATUS" "$ELAPSED_MS" "$MEMORY_USED" "$TC_SCORE" "$IS_SAMPLE" "$SCORE" "$TC_MESSAGE" <<'PY'
import json, sys
path, status, time_ms, mem_mb, score, is_sample, max_score, msg = sys.argv[1:9]
meta = {
    "status": status,
    "time_used": int(time_ms),
    "memory_used": int(mem_mb),
    "score": int(score),
    "is_sample": int(is_sample == 'true' or is_sample == '1'),
    "max_score": int(max_score),
}
if msg:
    meta["message"] = msg
with open(path, "w") as f:
    json.dump(meta, f)
PY
        echo "[JUDGE] Testcase $((i+1))/$N_CASES: REAL STATUS=$TC_STATUS (${ELAPSED_MS}ms)"
        continue
    fi

    # Check output size (OLE)
    OUTPUT_SIZE=$(stat -c%s "$WORK_DIR/outputs/$i.txt" 2>/dev/null || echo 0)
    if [ "$OUTPUT_SIZE" -gt "$MAX_OUTPUT_BYTES" ]; then
        TC_STATUS="output_limit_exceeded"
        TC_MESSAGE="Output limit exceeded ($OUTPUT_SIZE bytes > $MAX_OUTPUT_BYTES bytes)"
        TC_SCORE=0
        head -c $MAX_OUTPUT_BYTES "$WORK_DIR/outputs/$i.txt" > "$WORK_DIR/outputs/$i.txt.tmp"
        mv "$WORK_DIR/outputs/$i.txt.tmp" "$WORK_DIR/outputs/$i.txt"
        "$PY" - "$WORK_DIR/outputs/meta_$i.json" "$TC_STATUS" "$ELAPSED_MS" "$MEMORY_USED" "$TC_SCORE" "$IS_SAMPLE" "$SCORE" "$TC_MESSAGE" <<'PY'
import json, sys
path, status, time_ms, mem_mb, score, is_sample, max_score, msg = sys.argv[1:9]
meta = {
    "status": status,
    "time_used": int(time_ms),
    "memory_used": int(mem_mb),
    "score": int(score),
    "is_sample": int(is_sample == 'true' or is_sample == '1'),
    "max_score": int(max_score),
}
if msg:
    meta["message"] = msg
with open(path, "w") as f:
    json.dump(meta, f)
PY
        echo "[JUDGE] Testcase $((i+1))/$N_CASES: REAL STATUS=$TC_STATUS (${ELAPSED_MS}ms)"
        continue
    fi

    # Normal exit: diff or SPJ
    if [ "$JUDGE_TYPE" = "spj" ]; then
        TC_STATUS="pending_spj"
        TC_SCORE=0
    else
        VERDICT=$("$PY" -c "
expected = open('$WORK_DIR/expected/$i.txt').read()
actual = open('$WORK_DIR/outputs/$i.txt').read()
print('MATCH' if expected.strip() == actual.strip() else 'MISMATCH')
")
        if [ "$VERDICT" = "MATCH" ]; then
            TC_STATUS="accepted"
            TC_SCORE=$SCORE
        else
            TC_STATUS="wrong_answer"
            TC_MESSAGE="Output differs from expected"
            TC_SCORE=0
        fi
    fi

    "$PY" - "$WORK_DIR/outputs/meta_$i.json" "$TC_STATUS" "$ELAPSED_MS" "$MEMORY_USED" "$TC_SCORE" "$IS_SAMPLE" "$SCORE" "$TC_MESSAGE" <<'PY'
import json, sys
path, status, time_ms, mem_mb, score, is_sample, max_score, msg = sys.argv[1:9]
meta = {
    "status": status,
    "time_used": int(time_ms),
    "memory_used": int(mem_mb),
    "score": int(score),
    "is_sample": int(is_sample == 'true' or is_sample == '1'),
    "max_score": int(max_score),
}
if msg:
    meta["message"] = msg
with open(path, "w") as f:
    json.dump(meta, f)
PY
    echo "[JUDGE] Testcase $((i+1))/$N_CASES: REAL STATUS=$TC_STATUS (${ELAPSED_MS}ms, ${MEMORY_USED}MB)"
done

# ---------------- SPJ phase ----------------
if [ "$JUDGE_TYPE" = "spj" ]; then
    if [ -z "$SPJ_LANG" ] || [ -z "$SPJ_CODE" ]; then
        fail_json system_error "SPJ problem missing spj_language/spj_code" > result.json
        rm -rf "$WORK_DIR"
        exit 0
    fi

    # Stage cases
    for i in $(seq 0 $((N_CASES - 1))); do
        mkdir -p "$WORK_DIR/cases/$i"
        cp "$WORK_DIR/inputs/$i.txt" "$WORK_DIR/cases/$i/in.txt"
        cp "$WORK_DIR/outputs/$i.txt" "$WORK_DIR/cases/$i/out.txt"
        cp "$WORK_DIR/expected/$i.txt" "$WORK_DIR/cases/$i/expected.txt"
    done
    chmod -R a+r "$WORK_DIR/cases"

    # SPJ compile
    SPJ_COMPILE_CMD=""
    SPJ_ARGS=()
    case "$SPJ_LANG" in
        python)
            printf '%s' "$SPJ_CODE" > "$WORK_DIR/box/spj_solution.py"
            SPJ_COMPILE_CMD=""
            SPJ_ARGS=(/usr/bin/python3 -B /box/spj_solution.py)
            ;;
        cpp)
            printf '%s' "$SPJ_CODE" > "$WORK_DIR/box/spj_solution.cpp"
            SPJ_COMPILE_CMD="g++ -std=c++17 -O2 -o /box/spj_bin /box/spj_solution.cpp"
            SPJ_ARGS=("/box/spj_bin")
            ;;
        java)
            printf '%s' "$SPJ_CODE" > "$WORK_DIR/box/SpjMain.java"
            SPJ_COMPILE_CMD="javac /box/SpjMain.java"
            SPJ_ARGS=(/usr/bin/java -cp /box SpjMain)
            ;;
        javascript)
            printf '%s' "$SPJ_CODE" > "$WORK_DIR/box/spj_solution.js"
            SPJ_COMPILE_CMD=""
            SPJ_ARGS=(/usr/bin/node /box/spj_solution.js)
            ;;
        c)
            printf '%s' "$SPJ_CODE" > "$WORK_DIR/box/spj_solution.c"
            SPJ_COMPILE_CMD="gcc -std=c11 -O2 -o /box/spj_bin /box/spj_solution.c"
            SPJ_ARGS=("/box/spj_bin")
            ;;
        go)
            printf '%s' "$SPJ_CODE" > "$WORK_DIR/box/spj_main.go"
            SPJ_COMPILE_CMD="GOCACHE=/tmp/gocache GOFLAGS=-buildvcs=false go build -o /box/spj_bin /box/spj_main.go"
            SPJ_ARGS=("/box/spj_bin")
            ;;
        rust)
            printf '%s' "$SPJ_CODE" > "$WORK_DIR/box/spj_main.rs"
            SPJ_COMPILE_CMD="rustc -O -o /box/spj_bin /box/spj_main.rs"
            SPJ_ARGS=("/box/spj_bin")
            ;;
        *)
            fail_json system_error "Unsupported SPJ language: $SPJ_LANG" > result.json
            rm -rf "$WORK_DIR"
            exit 0
            ;;
    esac

    if [ -n "$SPJ_COMPILE_CMD" ]; then
        echo "[JUDGE] Compiling SPJ: $SPJ_COMPILE_CMD"
        $SUDO "$NSJAIL_BIN" \
            --quiet \
            --config "$NSJAIL_COMPILE_CFG" \
            --bindmount "$WORK_DIR/box:/box:rw" \
            --bindmount "$WORK_DIR/tmp:/tmp:rw" \
            --rlimit_as 512 \
            --rlimit_cpu 60 \
            --rlimit_nofile 64 \
            --rlimit_nproc 64 \
            --time_limit 60 \
            --max_cpus 2 \
            -- \
            /bin/bash -c "$SPJ_COMPILE_CMD" \
            > "$WORK_DIR/box/spj_compile_out.txt" 2>&1

        if [ $? -ne 0 ]; then
            SPJ_ERR=$(head -c 2000 "$WORK_DIR/box/spj_compile_out.txt")
            fail_json system_error "SPJ compilation failed: $SPJ_ERR" > result.json
            rm -rf "$WORK_DIR"
            exit 0
        fi
        echo "[JUDGE] SPJ compilation OK"
    fi

    # Run SPJ per case
    for i in $(seq 0 $((N_CASES - 1))); do
        SPJ_START=$(date +%s%N)
        $SUDO "$NSJAIL_BIN" \
            --quiet \
            --config "$NSJAIL_RUN_CFG" \
            --bindmount "$WORK_DIR/box:/box:rw" \
            --bindmount "$WORK_DIR/cases:/cases:ro" \
            --bindmount "$WORK_DIR/tmp:/tmp:rw" \
            --rlimit_as 512 \
            --rlimit_cpu 10 \
            --rlimit_nofile 32 \
            --rlimit_nproc 64 \
            --rlimit_fsize 1048576 \
            --time_limit 10 \
            --cgroup_mem_max 0 \
            --cgroup_pids_max 0 \
            --cgroup_cpu_ms_per_sec 0 \
            --max_cpus 1 \
            -- \
            "${SPJ_ARGS[@]}" "/cases/$i/in.txt" "/cases/$i/out.txt" "/cases/$i/expected.txt" \
            > "$WORK_DIR/box/spj_stdout_$i.txt" \
            2> "$WORK_DIR/box/spj_stderr_$i.txt"

        SPJ_RC=$?
        SPJ_END=$(date +%s%N)
        SPJ_MS=$(( (SPJ_END - SPJ_START) / 1000000 ))

        case $SPJ_RC in
            0)
                SPJ_STATUS="accepted"
                SPJ_MSG=""
                ;;
            1)
                SPJ_STATUS="wrong_answer"
                SPJ_MSG=$(head -c 500 "$WORK_DIR/box/spj_stderr_$i.txt" 2>/dev/null || echo "")
                ;;
            124)
                SPJ_STATUS="time_limit_exceeded"
                SPJ_MSG="SPJ time limit exceeded"
                ;;
            159)
                SPJ_STATUS="dangerous_operation"
                SPJ_MSG="SPJ forbidden system call detected"
                ;;
            *)
                SPJ_STATUS="system_error"
                SPJ_MSG="SPJ checker error (exit code $SPJ_RC)"
                ;;
        esac

        "$PY" - "$WORK_DIR/outputs/meta_$i.json" "$SPJ_STATUS" "$SPJ_MSG" "$SPJ_MS" <<'PY'
import json, sys
path, status, msg, ms = sys.argv[1:5]
with open(path) as f:
    meta = json.load(f)
meta["status"] = status
meta["time_used"] = max(meta.get("time_used", 0), int(ms))
if msg:
    meta["message"] = msg
else:
    meta.pop("message", None)
if status == "accepted":
    meta["score"] = meta.get("max_score", 0)
else:
    meta["score"] = 0
with open(path, "w") as f:
    json.dump(meta, f)
PY
    done
fi

# ---------------- generate result.json with backend-compatible status mapping ----------------
"$PY" - "$WORK_DIR" "$SUBMISSION_ID" <<'PY' > result.json
import json, sys, glob, os

work_dir, sid = sys.argv[1:3]

# Backend valid statuses (from internal.ts):
# accepted, wrong_answer, time_limit_exceeded, memory_limit_exceeded,
# runtime_error, compile_error, system_error, security_blocked
VALID_STATUSES = {
    'accepted', 'wrong_answer', 'time_limit_exceeded',
    'memory_limit_exceeded', 'runtime_error', 'compile_error',
    'system_error', 'security_blocked'
}

# Status mapping for backend compatibility
STATUS_MAP = {
    'dangerous_operation': 'security_blocked',
    'output_limit_exceeded': 'wrong_answer',
}

details = []
n_cases = len(glob.glob(os.path.join(work_dir, "outputs", "meta_*.json")))

logs = []

for i in range(n_cases):
    with open(os.path.join(work_dir, "outputs", f"meta_{i}.json")) as f:
        meta = json.load(f)

    real_status = meta["status"]
    mapped_status = STATUS_MAP.get(real_status, real_status)

    # If still not in valid statuses, fallback to system_error
    if mapped_status not in VALID_STATUSES:
        mapped_status = 'system_error'

    # Log the real status for debugging
    if real_status != mapped_status:
        logs.append({
            "log_type": "status_map",
            "message": f"Testcase {i}: real_status={real_status} -> mapped_status={mapped_status}"
        })

    detail = {
        "status": mapped_status,
        "time_used": meta["time_used"],
        "memory_used": meta["memory_used"],
        "score": meta["score"],
        "is_sample": meta["is_sample"],
    }

    # Preserve the real status and reason in the message field
    msg = meta.get("message", "")
    if real_status in ('dangerous_operation', 'output_limit_exceeded'):
        if msg:
            detail["message"] = f"[{real_status}] {msg}"
        else:
            detail["message"] = f"[{real_status}]"
    elif msg:
        detail["message"] = msg

    details.append(detail)

# Determine overall status by priority (using real statuses first)
real_priority = [
    "dangerous_operation",
    "system_error",
    "time_limit_exceeded",
    "memory_limit_exceeded",
    "output_limit_exceeded",
    "runtime_error",
    "wrong_answer",
    "accepted"
]
real_overall = "accepted"
for p in real_priority:
    if any(d.get("_real_status", "") == p for d in details):
        # We don't store _real_status, check from logs or re-read
        pass

# Re-read to get real overall status
real_statuses = []
for i in range(n_cases):
    with open(os.path.join(work_dir, "outputs", f"meta_{i}.json")) as f:
        meta = json.load(f)
    real_statuses.append(meta["status"])

real_overall = "accepted"
for p in real_priority:
    if p in real_statuses:
        real_overall = p
        break

# Map overall status for backend
mapped_overall = STATUS_MAP.get(real_overall, real_overall)
if mapped_overall not in VALID_STATUSES:
    mapped_overall = 'system_error'

# Add overall status log
if real_overall != mapped_overall:
    logs.append({
        "log_type": "status_map",
        "message": f"Overall: real_status={real_overall} -> mapped_status={mapped_overall}"
    })

# Add a summary log with the real status
logs.append({
    "log_type": "result",
    "message": f"Judging finished: real_status={real_overall}, mapped_status={mapped_overall}, score={sum(d['score'] for d in details)}, time={max((d['time_used'] for d in details), default=0)}ms, memory={max((d['memory_used'] for d in details), default=0)}KB"
})

score = sum(d["score"] for d in details)
time_used = max((d["time_used"] for d in details), default=0)
memory_used = max((d["memory_used"] for d in details), default=0)

result = {
    "submission_id": sid,
    "status": mapped_overall,
    "score": score,
    "time_used": time_used,
    "memory_used": memory_used,
    "details": details,
    "logs": logs
}
print(json.dumps(result, ensure_ascii=False))
PY

# Echo the real status to stdout (GitHub Actions log)
REAL_STATUS=$("$PY" -c "
import json, glob, os
work_dir = '$WORK_DIR'
real_priority = ['dangerous_operation','system_error','time_limit_exceeded','memory_limit_exceeded','output_limit_exceeded','runtime_error','wrong_answer','accepted']
real_statuses = []
for f in glob.glob(os.path.join(work_dir, 'outputs', 'meta_*.json')):
    import json
    with open(f) as fh:
        real_statuses.append(json.load(fh)['status'])
for p in real_priority:
    if p in real_statuses:
        print(p)
        break
else:
    print('accepted')
")
MAPPED_STATUS=$("$PY" -c "import json; print(json.load(open('result.json'))['status'])")
SCORE=$("$PY" -c "import json; print(json.load(open('result.json'))['score'])")

echo "[JUDGE] ============================================"
echo "[JUDGE] REAL STATUS: $REAL_STATUS"
echo "[JUDGE] MAPPED STATUS (for backend): $MAPPED_STATUS"
echo "[JUDGE] Score: $SCORE"
echo "[JUDGE] ============================================"

rm -rf "$WORK_DIR"
