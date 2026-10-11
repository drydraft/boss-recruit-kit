/**
 * boss-kit CLI · 配置
 * 所有可调项都走环境变量，便于在不同机器/CI 上复用，不写死任何个人路径。
 */

export const config = {
  /** 本地桥的 HTTP 控制面 */
  bridgeHttp: process.env.BOSS_BRIDGE_HTTP || 'http://127.0.0.1:8898',
  /** 本地桥的 WebSocket 端口（仅扩展使用，CLI 不直连） */
  bridgeWs: process.env.BOSS_BRIDGE_WS || 'ws://127.0.0.1:8899',
  /** 单次桥调用超时（毫秒） */
  timeoutMs: Number(process.env.BOSS_CALL_TIMEOUT_MS || 180000),
  /** 附件简历下载落盘目录（相对于浏览器默认下载目录） */
  downloadSubdir: process.env.BOSS_DOWNLOAD_DIR || 'boss-resumes',
  /** 简历截图默认输出目录 */
  captureDir: process.env.BOSS_CAPTURE_DIR || './out/resumes',
  /** 专用浏览器 profile 目录 */
  profileDir: process.env.BOSS_PROFILE_DIR || '',
  /** 浏览器可执行文件 */
  browserPath: process.env.BOSS_BROWSER_PATH || '',
};

/** 仓库根目录（packages/cli/src → ../../..） */
export function repoRoot() {
  return new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
}
