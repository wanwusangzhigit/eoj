export const LANGUAGES = [
  { value: 'python', label: 'Python 3' },
  { value: 'cpp', label: 'C++' },
  { value: 'java', label: 'Java' },
  { value: 'javascript', label: 'JavaScript (Node.js)' },
  { value: 'c', label: 'C' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
];

export const DEFAULT_CODE: Record<string, string> = {
  python: `# Write your solution here
def solve():
    pass

if __name__ == "__main__":
    import sys
    input = sys.stdin.read()
    print(solve())
`,
  cpp: `#include <iostream>
#include <vector>
using namespace std;

int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(nullptr);
    
    return 0;
}
`,
  java: `import java.util.*;

public class Main {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
    }
}
`,
  javascript: `// Write your solution here
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Implement solution
`,
  c: `#include <stdio.h>

int main() {
    return 0;
}
`,
  go: `package main

import (
    "fmt"
)

func main() {
}
`,
  rust: `use std::io;

fn main() {
    let mut input = String::new();
    io::stdin().read_line(&mut input).unwrap();
}
`,
};

export const DIFFICULTIES = [
  '暂无难度', '入门', '普及-', '普及',
  '提高', '提高+', '省选-', '省选',
  'NOI', 'NOI+', 'CTSC',
];

export const DIFFICULTY_COLORS: Record<string, string> = {
  '暂无难度': 'var(--diff-none)',
  '入门': 'var(--diff-easy)',
  '普及-': 'var(--diff-easy-mid)',
  '普及': 'var(--diff-mid)',
  '提高': 'var(--diff-hard)',
  '提高+': 'var(--diff-hard-plus)',
  '省选-': 'var(--diff-province)',
  '省选': 'var(--diff-province-plus)',
  'NOI': 'var(--diff-noi)',
  'NOI+': 'var(--diff-noi)',
  'CTSC': 'var(--diff-noi)',
  'Easy': 'var(--diff-mid)',
  'Medium': 'var(--diff-hard)',
  'Hard': 'var(--diff-easy)',
};

export const LANGUAGE_EXTENSIONS: Record<string, any> = {
  python: 'python',
  cpp: 'cpp',
  java: 'java',
  javascript: 'javascript',
  c: 'c',
  go: 'go',
  rust: 'rust',
};

export const LANGUAGE_TEMPLATES = DEFAULT_CODE;
