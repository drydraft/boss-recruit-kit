/**
 * 触达类命令：send / request-resume / favorite / audit / cleanup
 *
 * 铁律：所有写操作都以「会话里是否真的出现该消息」核验，不接受"点击成功"。
 */
import { readFile } from 'node:fs/promises';
import { call, closeResume, confirmMessage, openResume, openTarget } from '../bridge-client.mjs';
import { color, emit, info, table, warn } from '../util.mjs';

const MSG_PATTERN = /方便发一份.*简历吗/;

export const commands = {
  send: {
    desc: '给某人发消息并核验：boss send <会话id|姓名> --text "..." [--dry-run]',
    async run(args) {
      const target = args._[0];
      const text = String(args.text || '');
      if (!target || !text) throw new Error('用法：boss send <会话id|姓名> --text "消息内容"');
      const isId = /^\d/.test(target);
      const { snap } = await openTarget({ id: isId ? target : undefined, name: isId ? undefined : target, index: Number(args.index) || 0 });
      const person = snap.name || target;

      if (args['dry-run']) {
        emit(args, { ok: true, dryRun: true, person, text }, (d) => `${color.dim}[dry-run]${color.reset} 将发给 ${d.person}：${d.text}`);
        return;
      }
      const r = await call('chatSendText', { text }, 60000);
      const confirmed = await confirmMessage(new RegExp(text.slice(0, 8).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      emit(args, { ok: !!r.ok && !!confirmed, person, sent: !!r.ok, confirmed: !!confirmed, text }, (d) =>
        d.confirmed ? `${color.green}✓${color.reset} 已发送给 ${d.person}（会话已核验）`
                    : `${color.red}✗${color.reset} 发送未确认（输入框=${d.sent ? '已清空' : '仍有内容'}，会话未见消息）。见 docs/TROUBLESHOOTING.md「发送无反应」`);
    },
  },

  'request-resume': {
    desc: '点"求简历"并核验：boss request-resume <会话id|姓名>',
    async run(args) {
      const target = args._[0];
      if (!target) throw new Error('用法：boss request-resume <会话id|姓名>');
      const isId = /^\d/.test(target);
      const { snap } = await openTarget({ id: isId ? target : undefined, name: isId ? undefined : target, index: Number(args.index) || 0 });
      const person = snap.name || target;
      const r = await call('requestResume', {}, 60000);
      const confirmed = await confirmMessage(/简历请求已发送/);
      emit(args, { ok: !!r.ok && !!confirmed, person, requested: !!r.ok, confirmed: !!confirmed }, (d) =>
        d.confirmed ? `${color.green}✓${color.reset} 已向 ${d.person} 发出求简历（系统消息已核验）`
                    : `${color.red}✗${color.reset} 求简历未确认（tips=${d.requested ? '已点确定' : '未点到'}）`);
    },
  },

  favorite: {
    desc: '收藏某人（先读状态，避免把已收藏点成取消）：boss favorite <会话id|姓名>',
    async run(args) {
      const target = args._[0];
      if (!target) throw new Error('用法：boss favorite <会话id|姓名>');
      const isId = /^\d/.test(target);
      const { snap } = await openTarget({ id: isId ? target : undefined, name: isId ? undefined : target, index: Number(args.index) || 0 });
      const person = snap.name || target;
      await openResume();
      const st = await call('favoriteState', {}, 30000);
      if (st.favorited) {
        await closeResume();
        emit(args, { ok: true, person, favorite: '已收藏', changed: false },
          (d) => `${color.dim}${d.person}：已收藏（未改动）${color.reset}`);
        return;
      }
      if (st.mixed) warn('收藏按钮状态不明确（同时出现"收藏"与"已收藏"），跳过以免误取消');
      const f = st.mixed ? { ok: false } : await call('favoriteResume', { settleMs: 1500 }, 40000);
      await closeResume();
      emit(args, { ok: !!f.favorited, person, favorited: !!f.favorited, changed: true }, (d) =>
        d.favorited ? `${color.green}✓${color.reset} ${d.person} 已收藏` : `${color.red}✗${color.reset} ${d.person} 收藏失败`);
    },
  },

  cleanup: {
    desc: '清理僵尸/屏幕外简历弹层（解决"幽灵窄栏浮窗"与叠层）：boss cleanup',
    async run(args) {
      const r = await call('cleanupResumeDom', {}, 40000);
      emit(args, r, (d) => `已移除僵尸弹层 ${d.removed?.length ?? 0} 个，清除内联样式 ${d.cleared?.length ?? 0} 处`);
    },
  },

  audit: {
    desc: '逐人核验（指纹+话术+求简历+收藏）：boss audit --people people.json [--json]',
    async run(args) {
      let people = [];
      if (args.people) {
        const raw = await readFile(String(args.people), 'utf8');
        const parsed = JSON.parse(raw);
        people = Array.isArray(parsed) ? parsed : parsed.people || [];
      } else if (args.name) {
        people = String(args.name).split(',').map((s) => ({ name: s.trim() })).filter((p) => p.name);
      }
      if (!people.length) throw new Error('用法：boss audit --people people.json（元素形如 {"id":"<会话id>","name":"候选人A"}）');

      const rows = [];
      for (const p of people) {
        const rec = { name: p.name, id: p.id ?? '', fp: null, msg: null, request: null, favorite: null, error: null };
        try {
          const { snap } = await openTarget({ id: p.id, name: p.name, index: p.index || 0, want: { name: p.name, age: p.age, workExp0: p.workExp0 } });
          rec.fp = 'ok';
          rec.msg = (snap.messages || []).some((m) => m.dir === 'me' && MSG_PATTERN.test(m.text));
          rec.request = (snap.messages || []).some((m) => /简历请求已发送/.test(m.text));
          await openResume();
          const st = await call('favoriteState', {}, 30000);
          rec.favorite = st.favorited ? '已收藏' : (st.states || []).join('/');
          await closeResume();
        } catch (e) { rec.error = e.message.slice(0, 80); }
        rows.push(rec);
        info(`${rec.error ? '✗' : '·'} ${rec.name}${rec.error ? ' — ' + rec.error : ''}`);
      }
      const summary = {
        total: rows.length,
        fpOk: rows.filter((r) => r.fp === 'ok').length,
        msgOk: rows.filter((r) => r.msg).length,
        requestOk: rows.filter((r) => r.request).length,
        favOk: rows.filter((r) => r.favorite === '已收藏').length,
        failed: rows.filter((r) => r.error).length,
      };
      emit(args, { ok: summary.failed === 0, summary, rows }, (d) => table(
        d.rows.map((r) => ({
          name: r.name, id: r.id, fp: r.fp === 'ok' ? '一致' : (r.error ? '失败' : '—'),
          msg: r.msg ? '已发' : '—', request: r.request ? '已发' : '—',
          favorite: r.favorite || '—', note: r.error || '',
        })),
        [{ key: 'name', label: '姓名' }, { key: 'id', label: '会话id' }, { key: 'fp', label: '指纹' },
         { key: 'msg', label: '话术' }, { key: 'request', label: '求简历' }, { key: 'favorite', label: '收藏' }, { key: 'note', label: '备注' }],
      ) + `\n\n${color.bold}合计${color.reset} ${d.summary.total} 人｜指纹一致 ${d.summary.fpOk}｜话术 ${d.summary.msgOk}｜求简历 ${d.summary.requestOk}｜收藏 ${d.summary.favOk}｜失败 ${d.summary.failed}`);
    },
  },
};
