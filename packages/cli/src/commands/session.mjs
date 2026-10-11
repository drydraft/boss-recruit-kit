/**
 * 会话类命令：list（列会话）、open（打开某人并看指纹/消息）
 */
import { call, fingerprintOf, openTarget } from '../bridge-client.mjs';
import { color, emit, info, table } from '../util.mjs';

function itemsOf(r) {
  return r.items || r.list || r.rows || r.conversations || [];
}

export const commands = {
  list: {
    desc: '列出沟通列表会话：boss list [--limit 40] [--json]',
    async run(args) {
      const limit = Math.max(1, Math.min(500, Number(args.limit) || 40));
      const r = await call('chatList', { limit }, 60000);
      const items = itemsOf(r).slice(0, limit).map((x) => ({
        id: x.id ?? x.dataId ?? '',
        name: x.name ?? '',
        job: x.job ?? '',
        time: x.time ?? '',
        unread: x.unread ?? '',
        preview: String(x.preview ?? '').slice(0, 40),
      }));
      emit(args, { ok: true, count: items.length, items }, (d) => {
        if (!d.items.length) return '列表为空：确认浏览器停在 Boss 沟通页且已登录。';
        return table(d.items, [
          { key: 'id', label: '会话id' }, { key: 'name', label: '姓名' }, { key: 'job', label: '职位' },
          { key: 'time', label: '时间' }, { key: 'unread', label: '未读' }, { key: 'preview', label: '预览' },
        ]) + `\n\n${color.dim}共 ${d.count} 条。用 boss open <会话id> 打开某人。${color.reset}`;
      });
    },
  },

  open: {
    desc: '打开某人并打印指纹与最近消息：boss open <会话id|姓名> [--index N] [--messages N] [--json]',
    async run(args) {
      const target = args._[0];
      if (!target) throw new Error('用法：boss open <会话id|姓名> [--index N]');
      const isId = /^\d/.test(target);
      const { how, snap } = await openTarget({
        id: isId ? target : undefined,
        name: isId ? undefined : target,
        index: Number(args.index) || 0,
      });
      const n = Math.max(0, Math.min(50, Number(args.messages) || 6));
      const fp = fingerprintOf(snap);
      const data = {
        ok: true, how, fingerprint: fp,
        expectPosition: snap.expect ?? null,
        resumeButtons: snap.resumeBtns ?? null,
        messages: (snap.messages || []).slice(-n),
      };
      emit(args, data, (d) => [
        `${color.bold}${d.fingerprint.name}${color.reset}  ${d.fingerprint.age ?? ''}  ${d.fingerprint.edu ?? ''}  ${d.fingerprint.years ?? ''}`,
        `${color.dim}当前：${d.fingerprint.workExp0 ?? '-'}${color.reset}`,
        `${color.dim}定位方式：${d.how}｜在线简历：${d.resumeButtons?.online ? '有' : '无'}｜附件简历：${d.resumeButtons?.file ? '有' : '无'}${d.resumeButtons?.fileDisabled ? '（不可用）' : ''}${color.reset}`,
        '',
        ...d.messages.map((m) => `  ${m.dir === 'me' ? '我' : m.dir === 'candidate' ? '对方' : m.dir}: ${String(m.text).slice(0, 60)}`),
      ].join('\n'));
    },
  },
};
