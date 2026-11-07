import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const PANE = 'session-roster'
let HOME = ''
const selected = atom({ plugin: 'session-roster', key: 'selected' } as const, null as string | null, { shape: 'selected-1' })
const note = atom({ plugin: 'session-roster', key: 'note' } as const, '', { shape: 'note-1' })
const sent = atom({ plugin: 'session-roster', key: 'sent' } as const, [] as Sent[], { shape: 'sent-1' })
const tick = atom({ plugin: 'session-roster', key: 'tick' } as const, 0, { shape: 'tick-1' })

type Sent = { to: string; name: string; text: string; at: number; ok: boolean }
type Row = { id: string; name: string; repo: string; cwd: string; status: string; ago: string; mine: boolean; done: number; total: number; tmux: string }

// Per-session task list (~/.claude/tasks/<sessionId>/N.json): completed / total.
async function progressOf($: any, id: string): Promise<{ done: number; total: number }> {
  try {
    const dir = `${HOME}/.claude/tasks/${id}`
    let done = 0
    let total = 0
    for (const f of (await $.fs.list(dir)).filter((x: any) => /^\d+\.json$/.test(x.name))) {
      const t = JSON.parse(await $.fs.read(`${dir}/${f.name}`))
      if (t.status === 'deleted') continue
      total++
      if (t.status === 'completed') done++
    }
    return { done, total }
  } catch {
    return { done: 0, total: 0 }
  }
}

const W = 24
function bar(r: Row, t: number): string {
  if (r.total > 0) {
    const n = Math.round((W * r.done) / r.total)
    return `${'█'.repeat(n)}${'░'.repeat(W - n)} ${r.done}/${r.total}`
  }
  if (r.status !== 'busy') return ''
  const at = (t * 3) % (W - 4)
  return `${'░'.repeat(at)}████${'░'.repeat(W - 4 - at)} working`
}

const ago = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  return `${Math.round(s / 3600)}h`
}

async function repoOf($: any, cwd: string): Promise<string> {
  // origin URL from .git/config (follows a worktree's gitdir file); else folder name.
  try {
    let dir = `${cwd}/.git`
    const st = await $.fs.stat(dir)
    if (st.kind !== 'dir') {
      const g = (await $.fs.read(dir)).match(/gitdir:\s*(.+)/)?.[1]?.trim()
      if (g) dir = g.replace(/\/worktrees\/[^/]+$/, '')
    }
    const url = (await $.fs.read(`${dir}/config`)).match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/)?.[1]
    const name = url?.replace(/\.git$/, '').split(/[/:]/).slice(-2).join('/')
    if (name) return name
  } catch {}
  return cwd.split('/').filter(Boolean).pop() ?? cwd
}

async function sessions($: any): Promise<Row[]> {
  HOME = (await $.env.get('HOME')) ?? ''
  const hasProc = await $.fs.exists('/proc/self') // Linux only; elsewhere skip the liveness check
  const me = await $.session.id()
  const now = await $.clock.now()
  const dir = `${HOME}/.claude/sessions`
  const files = (await $.fs.list(dir)).filter((f: any) => f.name.endsWith('.json'))
  const rows: Row[] = []
  for (const f of files) {
    try {
      const s = JSON.parse(await $.fs.read(`${dir}/${f.name}`))
      if (!s.pid || (hasProc && !(await $.fs.exists(`/proc/${s.pid}`)))) continue
      rows.push({
        id: s.sessionId,
        name: s.name ?? s.sessionId.slice(0, 8),
        repo: await repoOf($, s.cwd),
        cwd: s.cwd,
        status: s.status ?? '?',
        ago: ago(now - (s.statusUpdatedAt ?? s.updatedAt ?? now)),
        mine: s.sessionId === me,
        tmux: s.tmux ?? '',
        ...(await progressOf($, s.sessionId)),
      })
    } catch {}
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'sessions', description: 'Show open Claude Code sessions and message them' })
    void $.ui.open({ id: PANE, title: 'Sessions' })
    $.clock.every(4000, () => { void update($, tick, n => n + 1) })
    return next(e)
  })

  on('command.run', { command: 'sessions' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Sessions', focus: true })
    return { text: 'Sessions pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const t = await read($, tick)
    const sel = await read($, selected)
    const msg = await read($, note)
    const rows = await sessions($)
    const log = await read($, sent)
    const now = await $.clock.now()
    const target = rows.find(r => r.id === sel)

    const send = async (text: string) => {
      if (!target || !text.trim()) return
      try {
        const from = rows.find(r => r.mine)
        const tag = from ? `[from session "${from.name}" in ${from.repo}; reply with SendMessage to this session] ` : ''
        await $.session.send({ to: { sessionId: target.id }, text: tag + text })
        await update($, note, () => `sent to ${target.name}`)
        const at = await $.clock.now()
        await update($, sent, l => [...l, { to: target.id, name: target.name, text, at, ok: true }].slice(-20))
      } catch (err: any) {
        await update($, note, () => `failed: ${err?.message ?? err}`)
        const at = await $.clock.now()
        await update($, sent, l => [...l, { to: target.id, name: target.name, text, at, ok: false }].slice(-20))
      }
    }

    // "rpg:@134.%134" -> window @134, pane %134
    const jump = async () => {
      const m = target?.tmux.match(/(@\d+)\.(%\d+)/)
      if (!target || !m) {
        await update($, note, () => 'no tmux window recorded for that session')
        return
      }
      try {
        let r = await $.process.run(['tmux', 'switch-client', '-t', m[2]])
        if (r.exitCode !== 0) {
          await $.process.run(['tmux', 'select-window', '-t', m[1]])
          r = await $.process.run(['tmux', 'select-pane', '-t', m[2]])
        }
        await update($, note, () => (r.exitCode === 0 ? `jumped to ${target.name}` : `tmux: ${r.stderr.trim()}`))
      } catch (err: any) {
        await update($, note, () => `tmux failed: ${err?.message ?? err}`)
      }
    }

    return (
      <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
        <Text bold color="claude">◆ Sessions <Text color="subtle">({rows.length} open)</Text></Text>
        {rows.length === 0 && <Text dimColor>No open sessions found.</Text>}
        {rows.map((r, i) => (
          <Box key={r.id} flexDirection="column">
            <Button key={r.id} hotkey={i < 9 ? String(i + 1) : undefined} onPress={() => { void update($, selected, () => r.id) }}>
              <Text color="subtle">{i < 9 ? `${i + 1} ` : '  '}</Text>
              <Text color="claude">{r.id === sel ? '▶ ' : '  '}</Text>
              <Text bold color={r.mine ? 'permission' : 'claude'}>{r.name}</Text>
              <Text color="permission">{r.mine ? ' (this)' : ''}</Text>
              <Text color="suggestion"> {r.repo}</Text>
              <Text color={r.status === 'busy' ? 'warning' : 'success'}> ● {r.status}</Text>
              <Text dimColor> {r.ago}</Text>
            </Button>
            {bar(r, t) !== '' && <Text color={r.total > 0 && r.done === r.total ? 'success' : r.total > 0 ? 'permission' : 'warning'}>{'    '}{bar(r, t)}</Text>}
          </Box>
        ))}
        <Text> </Text>
        {target && !target.mine && target.tmux !== '' && (
          <Button key="jump" hotkey="g" onPress={() => { void jump() }}>
            <Text color="permission">g  Jump to {target.name}'s tmux window</Text>
          </Button>
        )}
        {target && !target.mine ? (
          <Input key="msg" label={`Message ${target.name}`} placeholder="type, Enter to send" onSubmit={v => { void send(v) }} />
        ) : (
          <Text dimColor>{target?.mine ? 'Pick another session to message.' : 'Select a session to message it.'}</Text>
        )}
        {msg !== '' && <Text dimColor>{msg}</Text>}
        {log.length > 0 && <Text bold color="claude">Sent</Text>}
        {log.slice(-8).reverse().map(m => {
          const r = rows.find(x => x.id === m.to)
          const st = !m.ok ? 'FAILED' : r ? `${r.status} ${r.ago}` : 'session closed'
          const c = !m.ok ? 'error' : r ? (r.status === 'busy' ? 'warning' : 'success') : 'inactive'
          return (
            <Text>
              <Text dimColor>{ago(now - m.at)} ago </Text>
              <Text color="merged">→ </Text>
              <Text bold color="claude">{m.name}</Text>
              <Text color="text">: {m.text.slice(0, 40)} </Text>
              <Text color={c}>[{st}]</Text>
            </Text>
          )
        })}
      </Box>
    )
  })
}
