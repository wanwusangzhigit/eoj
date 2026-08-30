import { fetchWithTimeout } from './fetch-timeout';

interface Testcase {
  input: string;
  expected_output: string;
  is_sample: boolean;
  score: number;
}

interface Env {
  GITHUB_TOKEN: string;
  JUDGE_REPO: string;
}

export async function fetchTestcases(env: Env, slug: string): Promise<Testcase[]> {
  const filePath = `testcases/${slug}.json`;
  const response = await fetchWithTimeout(
    `https://api.github.com/repos/${env.JUDGE_REPO}/contents/${filePath}`,
    {
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3.raw',
        'User-Agent': 'OJ-System',
      },
    }
  );

  if (!response.ok) {
    if (response.status === 404) return [];
    console.error('GitHub testcase fetch failed:', response.status);
    return [];
  }

  try {
    return await response.json();
  } catch (e) {
    console.error('Invalid testcase JSON:', e);
    return [];
  }
}

export async function saveTestcases(env: Env, slug: string, testcases: Testcase[]): Promise<boolean> {
  const filePath = `testcases/${slug}.json`;
  const content = JSON.stringify(testcases, null, 2);
  const encodedContent = btoa(content);

  // Get current file SHA for update (required by GitHub API)
  const currentFile = await fetchWithTimeout(
    `https://api.github.com/repos/${env.JUDGE_REPO}/contents/${filePath}`,
    {
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'OJ-System',
      },
    }
  );

  let sha: string | null = null;
  if (currentFile.ok) {
    const fileData = await currentFile.json() as any;
    sha = fileData.sha;
  }

  const body: any = {
    message: sha ? `Update testcases for ${slug}` : `Add testcases for ${slug}`,
    content: encodedContent,
  };
  if (sha) {
    body.sha = sha;
  }

  const response = await fetchWithTimeout(
    `https://api.github.com/repos/${env.JUDGE_REPO}/contents/${filePath}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'OJ-System',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('GitHub testcase save failed:', response.status, errorBody);
    return false;
  }

  return true;
}

export async function deleteTestcases(env: Env, slug: string): Promise<boolean> {
  const filePath = `testcases/${slug}.json`;

  // Get current file SHA (required for delete)
  const currentFile = await fetchWithTimeout(
    `https://api.github.com/repos/${env.JUDGE_REPO}/contents/${filePath}`,
    {
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'OJ-System',
      },
    }
  );

  if (!currentFile.ok) {
    // File doesn't exist, nothing to delete
    return true;
  }

  const fileData = await currentFile.json() as any;
  const sha = fileData.sha;

  const response = await fetchWithTimeout(
    `https://api.github.com/repos/${env.JUDGE_REPO}/contents/${filePath}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'OJ-System',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `Delete testcases for ${slug}`,
        sha,
      }),
    }
  );

  if (!response.ok) {
    console.error('GitHub testcase delete failed:', response.status);
    return false;
  }

  return true;
}
