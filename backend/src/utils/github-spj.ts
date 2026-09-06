import { getLanguageExt } from './helpers';
import { fetchWithTimeout } from './fetch-timeout';

interface Env {
  GITHUB_TOKEN: string;
  JUDGE_REPO: string;
}

export async function fetchSpjCode(env: Env, slug: string, language: string): Promise<string | null> {
  const ext = getLanguageExt(language);
  const filePath = `spj/${slug}.${ext}`;
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
    if (response.status === 404) return null;
    console.error('GitHub SPJ fetch failed:', response.status);
    return null;
  }

  return await response.text();
}

export async function saveSpjCode(env: Env, slug: string, language: string, code: string): Promise<boolean> {
  const ext = getLanguageExt(language);
  const filePath = `spj/${slug}.${ext}`;
  const encodedContent = btoa(unescape(encodeURIComponent(code)));

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
    message: sha ? `Update SPJ for ${slug}` : `Add SPJ for ${slug}`,
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
    console.error('GitHub SPJ save failed:', response.status, errorBody);
    return false;
  }

  return true;
}

export async function deleteSpjCode(env: Env, slug: string, language: string): Promise<boolean> {
  const ext = getLanguageExt(language);
  const filePath = `spj/${slug}.${ext}`;

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
        message: `Delete SPJ for ${slug}`,
        sha,
      }),
    }
  );

  if (!response.ok) {
    console.error('GitHub SPJ delete failed:', response.status);
    return false;
  }

  return true;
}
