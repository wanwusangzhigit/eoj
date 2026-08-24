// 上传数据(JSON/ZIP 批量导入)时,将 100 分总分均匀分配给每个非样例测试点(样例为 0 分)。
// 返回新的 testcase 数组(不修改入参)。
export function distributeScores(testcases: any[]): any[] {
  const result = testcases.map((tc) => ({ ...tc, is_sample: !!tc.is_sample }));
  const normals = result.filter((tc) => !tc.is_sample);
  if (normals.length === 0) return result;
  const base = Math.floor(100 / normals.length);
  const remainder = 100 - base * normals.length;
  normals.forEach((tc, i) => {
    tc.score = base + (i < remainder ? 1 : 0);
  });
  return result;
}