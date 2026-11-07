declare module 'claude-code' {
  interface PluginState {
    'session-roster': {
      selected: Shaped<string | null>
      note: Shaped<string>
      tick: Shaped<number>
      sent: Shaped<{ to: string; name: string; text: string; at: number; ok: boolean }[]>
    }
  }
}
