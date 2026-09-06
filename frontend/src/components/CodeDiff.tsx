import { useMemo } from 'react';
import { t } from '../i18n';
import './CodeDiff.css';

interface CodeDiffProps {
  codeA: string;
  codeB: string;
  language?: string;
}

// Compute per-line diff using LCS algorithm to find similar lines
function computeDiff(linesA: string[], linesB: string[]) {
  const m = linesA.length;
  const n = linesB.length;

  // Use LCS on lines (treat each line as a token)
  const dp: number[][] = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (linesA[i - 1] === linesB[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to mark matched lines
  const matchedA = new Set<number>();
  const matchedB = new Set<number>();
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (linesA[i - 1] === linesB[j - 1]) {
      matchedA.add(i - 1);
      matchedB.add(j - 1);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return { matchedA, matchedB };
}

export default function CodeDiff({ codeA, codeB, language = '' }: CodeDiffProps) {
  const linesA = useMemo(() => (codeA || '').split('\n'), [codeA]);
  const linesB = useMemo(() => (codeB || '').split('\n'), [codeB]);

  const { matchedA, matchedB } = useMemo(() => computeDiff(linesA, linesB), [linesA, linesB]);

  return (
    <div className="code-diff-container">
      <div className="code-diff-column">
        <div className="code-diff-header">
          {t('plagiarism.submissionA')}
          {language && <span className="lang-tag">{language}</span>}
        </div>
        <pre className="code-diff-pre">
          {linesA.map((line, idx) => (
            <div key={idx} className={`code-diff-line ${matchedA.has(idx) ? 'matched' : 'unmatched'}`}>
              <span className="line-number">{idx + 1}</span>
              <span className="line-content">{line || ' '}</span>
            </div>
          ))}
        </pre>
      </div>
      <div className="code-diff-column">
        <div className="code-diff-header">
          {t('plagiarism.submissionB')}
          {language && <span className="lang-tag">{language}</span>}
        </div>
        <pre className="code-diff-pre">
          {linesB.map((line, idx) => (
            <div key={idx} className={`code-diff-line ${matchedB.has(idx) ? 'matched' : 'unmatched'}`}>
              <span className="line-number">{idx + 1}</span>
              <span className="line-content">{line || ' '}</span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
