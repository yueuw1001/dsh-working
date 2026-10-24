/**
 * Client half of the Task Monitor bundle.
 *
 * The board lives in a central panel opened from a left-sidebar panel icon
 * (`sidebar.panellist` + `main`). A hidden controller mounted in
 * `shell.overlay` watches the sidebar sessions at all times, so runs are
 * collected even while the panel is closed. Task cards are created only by
 * that controller: there is no manual "add task" form.
 *
 * A session that starts running gains a card in Running. When it stops, the
 * card's terminal lane comes from the retained session's last `turn/end`
 * reason: `completed` → Finished; error / user stop / interruption /
 * token-or-blocked end → Incomplete.
 */
window.__ModuleLoader__.load({
  id: '@local/task-monitor',
  factory(require) {
    'use strict'

    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const NS = 'taskMonitor'
    const PANEL_ID = 'task-monitor'
    const STORAGE_KEY = 'dsh.task-monitor.board.v1'
    const LANE_IDS = ['queued', 'running', 'done', 'incomplete']
    const LANE_META = {
      queued: { key: 'laneQueued', tone: 'var(--dsw-alias-state-idle-primary)' },
      running: { key: 'laneRunning', tone: 'var(--dsw-alias-brand-primary)' },
      done: { key: 'laneDone', tone: 'var(--dsw-alias-state-success-primary)' },
      incomplete: { key: 'laneIncomplete', tone: 'var(--dsw-alias-state-warn-primary)' },
    }
    const MAX_TASKS = 400
    const PATH_MAX = 400
    const RECENT_PATHS_MAX = 8

    const en = {
      title: 'Task Monitor',
      subtitle: '{total} tasks · {running} running',
      subtitleIdle: '{total} tasks · nothing running',
      laneQueued: 'Queued',
      laneRunning: 'Running',
      laneDone: 'Finished',
      laneIncomplete: 'Incomplete',
      clearFinished: 'Clear finished',
      addProject: 'Add project',
      addProjectPlaceholder: 'Name a project, Enter adds it to Queued',
      projectTag: 'Project',
      empty: 'No tasks',
      remove: 'Delete task',
      rename: 'Rename task',
      syncOn: 'Auto-sync on',
      syncOff: 'Auto-sync unavailable',
      syncHint: 'Running sidebar sessions appear in Running; a normal finish moves the card to Finished, an error or interruption to Incomplete',
      pageHint: 'Running sessions are collected automatically',
      sessionTag: 'Session',
      projectTag: 'Project',
      tokensSuffix: 'tokens',
      tokensHint: 'Total {total} tokens',
      tokensBreakdown: 'Total {total} tokens · input {input} · output {output} · cache read {read} · cache write {write}',
      soundOn: 'Completion sound: on',
      soundOff: 'Completion sound: off',
      balanceLabel: 'Balance',
      todayLabel: 'Today',
      balanceTitle: 'Remaining account balance',
      todayTokensTitle: "Today's token usage across all sessions",
      todayCostTitle: "Today's estimated spend (model prices)",
      runningMeta: 'Running {time}',
      createdMeta: 'Created {time}',
      finishedMeta: 'Finished {time}',
      stoppedMeta: 'Stopped {time}',
      tookMeta: '· took {time}',
      movedTitle: 'Task Monitor moved to the left sidebar',
      movedBody: 'This tab is retired. Open the board from the Task Monitor icon in the left sidebar.',
      movedOpen: 'Open the board',
      pathPlaceholder: 'Project folder, e.g. D:\\work\\my-app (optional)',
      pathPickTitle: 'Choose a folder',
      pathPickHint: 'Browsers return only the folder name; complete it to a full path',
      pathNote: 'Picked “{name}” — browsers hide the absolute path, so complete it (e.g. C:\\work\\{name})',
      pathAdd: 'Add path',
      pathEditTitle: 'Set the project folder',
      pathCopyTitle: 'Copy this path',
      pathCopied: 'Copied',
    }

    const zh = {
      title: '任务监控',
      subtitle: '共 {total} 项 · {running} 项运行中',
      subtitleIdle: '共 {total} 项 · 暂无运行中',
      laneQueued: '待运行',
      laneRunning: '运行中',
      laneDone: '已结束',
      laneIncomplete: '未完成',
      clearFinished: '清理已结束',
      addProject: '添加项目',
      addProjectPlaceholder: '输入项目名称，回车加入待运行',
      projectTag: '项目',
      empty: '暂无任务',
      remove: '删除任务',
      rename: '重命名任务',
      syncOn: '自动同步',
      syncOff: '自动同步不可用',
      syncHint: '侧边栏中正在运行的会话会自动进入「运行中」；正常完成移到「已结束」，出错或被中断移到「未完成」',
      pageHint: '运行中的会话会自动收录',
      sessionTag: '会话',
      projectTag: '项目',
      tokensSuffix: 'tokens',
      tokensHint: '累计 {total} tokens',
      tokensBreakdown: '累计 {total} tokens · 输入 {input} · 输出 {output} · 缓存读 {read} · 缓存写 {write}',
      soundOn: '完成声音提示：开',
      soundOff: '完成声音提示：关',
      balanceLabel: '余额',
      todayLabel: '今日',
      balanceTitle: '账户剩余金额',
      todayTokensTitle: '今日全部会话的 token 用量',
      todayCostTitle: '今日花费（按模型单价估算）',
      runningMeta: '运行中 {time}',
      createdMeta: '创建于 {time}',
      finishedMeta: '完成于 {time}',
      stoppedMeta: '停止于 {time}',
      tookMeta: '· 用时 {time}',
      movedTitle: '任务监控已移到左侧边栏',
      movedBody: '这个标签页已停用，请从左侧边栏的「任务监控」图标打开看板。',
      movedOpen: '打开看板',
      pathPlaceholder: '项目路径，可选，如 D:\\work\\my-app',
      pathPickTitle: '选择文件夹',
      pathPickHint: '浏览器只返回文件夹名，请补全为完整路径',
      pathNote: '已选择「{name}」——浏览器不提供绝对路径，请补全（如 C:\\work\\{name}）',
      pathAdd: '添加路径',
      pathEditTitle: '设置项目文件夹',
      pathCopyTitle: '点击复制路径',
      pathCopied: '已复制',
    }

    const DICTS = { en: en, zh: zh }
    let moduleLocale
    let moduleCtx

    // ------------------------------------------------------------------
    // Small helpers
    // ------------------------------------------------------------------

    function pad2(value) {
      return value < 10 ? '0' + value : String(value)
    }

    function clockTime(stamp) {
      const date = new Date(typeof stamp === 'number' ? stamp : Date.now())
      return pad2(date.getHours()) + ':' + pad2(date.getMinutes())
    }

    function elapsedText(ms) {
      if (!Number.isFinite(ms) || ms < 0) return '0:00'
      const total = Math.floor(ms / 1000)
      const seconds = total % 60
      const minutes = Math.floor(total / 60) % 60
      const hours = Math.floor(total / 3600)
      return hours > 0
        ? hours + ':' + pad2(minutes) + ':' + pad2(seconds)
        : minutes + ':' + pad2(seconds)
    }

    /** Compact token counts for a card line (1.2k / 3.4M). */
    function formatTokens(value) {
      if (!Number.isFinite(value) || value <= 0) return '0'
      if (value >= 1000000) return (value / 1000000).toFixed(value >= 10000000 ? 0 : 1) + 'M'
      if (value >= 1000) return (value / 1000).toFixed(value >= 10000 ? 0 : 1) + 'k'
      return String(Math.round(value))
    }

    /** Normalize the `tokenUsage` session projection into one totals object. */
    function sumTokenUsage(usage) {
      if (usage === null || usage === undefined || typeof usage !== 'object') return undefined
      const input = Number(usage.uncachedInputTokens) || 0
      const output = Number(usage.outputTokens) || 0
      const cacheRead = Number(usage.cacheReadTokens) || 0
      const cacheWrite = Number(usage.cacheWriteTokens) || 0
      return {
        total: input + output + cacheRead + cacheWrite,
        input: input,
        output: output,
        cacheRead: cacheRead,
        cacheWrite: cacheWrite,
      }
    }

    function sameTokenUsage(a, b) {
      if (a === b) return true
      if (a === null || a === undefined || b === null || b === undefined) return false
      return a.total === b.total && a.input === b.input && a.output === b.output
        && a.cacheRead === b.cacheRead && a.cacheWrite === b.cacheWrite
    }

    /** Currency text for the header stats (CNY/USD, two decimals). */
    function formatMoney(amount, currency) {
      const symbol = String(currency || 'CNY').toUpperCase() === 'USD' ? '$' : '¥'
      if (!Number.isFinite(amount)) return symbol + '—'
      try {
        return symbol + amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      } catch (error) {
        return symbol + amount.toFixed(2)
      }
    }

    /** Today's spend across currencies, e.g. "¥0.56" or "¥0.56 + $0.02". */
    function formatTodayMoney(today) {
      const byCurrency = today !== null && today !== undefined && today.byCurrency ? today.byCurrency : {}
      const keys = Object.keys(byCurrency).filter(function (key) { return Number.isFinite(byCurrency[key]) })
      if (keys.length === 0) return '—'
      keys.sort(function (a, b) {
        if (a === 'CNY') return -1
        if (b === 'CNY') return 1
        return a < b ? -1 : a > b ? 1 : 0
      })
      return keys.map(function (key) { return formatMoney(byCurrency[key], key) }).join(' + ')
    }

    function uid() {
      try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
      } catch (error) {
        // Fall through.
      }
      return 'task-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
    }

    /**
     * A project path is reader-typed text: trim spaces and wrapping quotes,
     * unify the separators of a Windows / UNC path and drop trailing ones.
     * Empty means "no path". It is display-and-copy only — the board never
     * touches the disk, so any absolute path the reader pastes is kept as-is.
     */
    function normalizePath(raw) {
      if (typeof raw !== 'string') return ''
      let text = raw.trim()
      if (text.length >= 2) {
        const head = text.charAt(0)
        const tail = text.charAt(text.length - 1)
        if ((head === '"' && tail === '"') || (head === "'" && tail === "'")) text = text.slice(1, -1).trim()
      }
      if (text === '') return ''
      const unc = /^\\\\/.test(text)
      if (/^[a-zA-Z]:[\\/]/.test(text) || unc) {
        let body = unc ? text.slice(2) : text
        body = body.replace(/\//g, '\\').replace(/\\{2,}/g, '\\')
        if (unc) return ('\\\\' + body.replace(/^\\+/, '').replace(/\\+$/, '')).slice(0, PATH_MAX)
        const root = body.slice(0, 2).toUpperCase()
        const rest = body.slice(2).replace(/^\\+/, '').replace(/\\+$/, '')
        return (rest === '' ? root + '\\' : root + '\\' + rest).slice(0, PATH_MAX)
      }
      text = text.replace(/\/{2,}/g, '/')
      if (text.length > 1) text = text.replace(/\/+$/, '')
      if (text === '') text = '/'
      return text.slice(0, PATH_MAX)
    }

    /** Case-insensitive on purpose: Windows folds drive letters and folder names. */
    function samePath(left, right) {
      const a = normalizePath(left)
      const b = normalizePath(right)
      return a !== '' && b !== '' && a.toLowerCase() === b.toLowerCase()
    }

    /** Keep the drive and the deepest folders, which is what identifies a card. */
    function shortPath(path) {
      const text = String(path || '')
      if (text.length <= 44) return text
      return text.slice(0, 9) + '…' + text.slice(text.length - 32)
    }

    function copyText(text) {
      const value = String(text)
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard
          && typeof navigator.clipboard.writeText === 'function') {
          return navigator.clipboard.writeText(value).then(function () { return true }, function () {
            return legacyCopy(value)
          })
        }
      } catch (error) {
        // Fall through to the legacy path.
      }
      return Promise.resolve(legacyCopy(value))
    }

    function legacyCopy(text) {
      try {
        if (typeof document === 'undefined' || !document.body) return false
        const area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.top = '-1000px'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        const ok = typeof document.execCommand === 'function' && document.execCommand('copy') === true
        document.body.removeChild(area)
        return ok
      } catch (error) {
        return false
      }
    }

    function dictFor(active) {
      return String(active || '').toLowerCase().indexOf('zh') === 0 ? zh : en
    }

    function translate(dict, key, params) {
      let text = dict && typeof dict[key] === 'string' ? dict[key] : en[key]
      if (typeof text !== 'string') text = key
      if (params !== undefined && params !== null) {
        Object.keys(params).forEach(function (name) {
          text = text.split('{' + name + '}').join(String(params[name]))
        })
      }
      return text
    }

    function activeLocaleOf(locale) {
      try {
        if (locale !== undefined && locale !== null && typeof locale.getSnapshot === 'function') {
          const snapshot = locale.getSnapshot()
          if (snapshot !== undefined && snapshot !== null && typeof snapshot.active === 'string') return snapshot.active
        }
      } catch (error) {
        // Fall through to the browser language.
      }
      try {
        if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') return navigator.language
      } catch (error) {
        // No navigator: English.
      }
      return 'en'
    }

    function useActiveLocale(locale) {
      const [active, setActive] = useState(function () { return activeLocaleOf(locale) })
      useEffect(function () {
        setActive(activeLocaleOf(locale))
        if (locale === undefined || locale === null || typeof locale.subscribe !== 'function') return undefined
        function onLocaleChange() { setActive(activeLocaleOf(locale)) }
        try {
          return locale.subscribe(onLocaleChange)
        } catch (error) {
          return undefined
        }
      }, [locale])
      return active
    }

    function useTranslator(locale) {
      const active = useActiveLocale(locale)
      const dict = dictFor(active)
      const tr = useCallback(function (key, params) {
        return translate(dict, key, params)
      }, [dict])
      return tr
    }

    // ------------------------------------------------------------------
    // Persistence and the shared board store
    // ------------------------------------------------------------------

    function isTask(value) {
      if (value === null || typeof value !== 'object') return false
      if (typeof value.id !== 'string' || typeof value.title !== 'string') return false
      return LANE_IDS.indexOf(value.status) !== -1 && typeof value.createdAt === 'number'
    }

    function readStored() {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return null
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (raw === null || raw === '') return null
        const data = JSON.parse(raw)
        if (data === null || typeof data !== 'object') return null
        const tasks = Array.isArray(data.tasks)
          ? data.tasks.filter(isTask).slice(0, MAX_TASKS).map(function (task) {
              return {
                id: task.id,
                title: String(task.title).slice(0, 200),
                status: task.status,
                createdAt: task.createdAt,
                startedAt: typeof task.startedAt === 'number' ? task.startedAt : undefined,
                finishedAt: typeof task.finishedAt === 'number' ? task.finishedAt : undefined,
                durationMs: typeof task.durationMs === 'number' ? task.durationMs : undefined,
                sessionId: typeof task.sessionId === 'string' ? task.sessionId : undefined,
                source: task.source === 'session' ? 'session' : undefined,
                auto: task.auto !== false,
                tokens: typeof task.tokens === 'number' ? task.tokens : undefined,
                tokenUsage: task.tokenUsage !== null && typeof task.tokenUsage === 'object'
                  ? {
                      total: Number(task.tokenUsage.total) || 0,
                      input: Number(task.tokenUsage.input) || 0,
                      output: Number(task.tokenUsage.output) || 0,
                      cacheRead: Number(task.tokenUsage.cacheRead) || 0,
                      cacheWrite: Number(task.tokenUsage.cacheWrite) || 0,
                    }
                  : undefined,
                path: typeof task.path === 'string' ? normalizePath(task.path) || undefined : undefined,
              }
            })
          : []
        const ignored = Array.isArray(data.ignored)
          ? data.ignored.filter(function (id) { return typeof id === 'string' }).slice(0, 200)
          : []
        const recentPaths = []
        if (Array.isArray(data.recentPaths)) {
          data.recentPaths.forEach(function (item) {
            if (typeof item !== 'string') return
            const path = normalizePath(item)
            if (path === '' || recentPaths.length >= RECENT_PATHS_MAX) return
            if (recentPaths.some(function (known) { return samePath(known, path) })) return
            recentPaths.push(path)
          })
        }
        return {
          tasks: tasks,
          ignored: ignored,
          recentPaths: recentPaths,
          soundEnabled: data.soundEnabled !== false,
        }
      } catch (error) {
        return null
      }
    }

    function writeStored(state) {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
          tasks: state.tasks,
          ignored: state.ignored,
          recentPaths: state.recentPaths,
          soundEnabled: state.soundEnabled !== false,
        }))
      } catch (error) {
        // Storage may be unavailable or full; the board still works in memory.
      }
    }

    const initialBoard = readStored()
    let boardState = {
      tasks: initialBoard !== null && initialBoard.tasks !== null ? initialBoard.tasks : [],
      ignored: initialBoard !== null && initialBoard.ignored !== null ? initialBoard.ignored : [],
      recentPaths: initialBoard !== null && initialBoard.recentPaths !== null ? initialBoard.recentPaths : [],
      syncAvailable: false,
      soundEnabled: initialBoard !== null && initialBoard.soundEnabled === false ? false : true,
      balance: null,
      today: null,
    }
    const boardListeners = new Set()

    function boardSnapshot() {
      return boardState
    }

    function subscribeBoard(listener) {
      boardListeners.add(listener)
      return function () { boardListeners.delete(listener) }
    }

    function publishBoard() {
      writeStored(boardState)
      boardListeners.forEach(function (listener) {
        try { listener() } catch (error) { /* one broken listener must not stop the others */ }
      })
    }

    function updateBoard(patch) {
      const next = { ...boardState, ...patch }
      if (next.tasks === boardState.tasks && next.ignored === boardState.ignored
        && next.recentPaths === boardState.recentPaths
        && next.syncAvailable === boardState.syncAvailable && next.soundEnabled === boardState.soundEnabled
        && next.balance === boardState.balance && next.today === boardState.today) return
      boardState = next
      publishBoard()
    }

    function setBoardTasks(updater) {
      const next = updater(boardState.tasks)
      if (next !== boardState.tasks) updateBoard({ tasks: next })
    }

    function setBoardIgnored(updater) {
      const next = updater(boardState.ignored)
      if (next !== boardState.ignored) updateBoard({ ignored: next })
    }

    function setSyncAvailable(next) {
      if (boardState.syncAvailable !== next) updateBoard({ syncAvailable: next })
    }

    function setSoundEnabled(next) {
      const enabled = next === true
      if (boardState.soundEnabled !== enabled) updateBoard({ soundEnabled: enabled })
    }

    /** Most-recent first, case-insensitively de-duplicated; feeds the datalist. */
    function rememberRecentPath(path) {
      const value = normalizePath(path)
      if (value === '') return
      const known = boardState.recentPaths
      if (known.length > 0 && samePath(known[0], value)) return
      const next = [value].concat(known.filter(function (item) {
        return !samePath(item, value)
      })).slice(0, RECENT_PATHS_MAX)
      updateBoard({ recentPaths: next })
    }

    function setBoardBalance(next) {
      const current = boardState.balance
      if (current !== null && current !== undefined && next !== null && next !== undefined
        && current.amount === next.amount && current.currency === next.currency) return
      updateBoard({ balance: next })
    }

    function setBoardToday(next) {
      if (next === null || next === undefined) return
      const current = boardState.today
      const sameCurrency = current !== null && current !== undefined
        && JSON.stringify(current.byCurrency || {}) === JSON.stringify(next.byCurrency || {})
      if (current !== null && current !== undefined && current.tokens === next.tokens && current.day === next.day && sameCurrency) return
      updateBoard({ today: next })
    }

    function useBoardState() {
      const [state, setState] = useState(boardSnapshot)
      useEffect(function () {
        setState(boardSnapshot())
        return subscribeBoard(function () { setState(boardSnapshot()) })
      }, [])
      return state
    }

    // ------------------------------------------------------------------
    // Completion chime
    // ------------------------------------------------------------------
    //
    // A short synthesized two-note chime keeps the bundle asset-free. Browsers
    // require a user gesture before audio may start, so the context is created
    // and resumed on the first pointer/key gesture (see `apply`), and every
    // sound is best effort: a blocked context never disturbs the board.

    let audioContext = null
    let lastChimeAt = 0

    function ensureAudioContext() {
      try {
        if (typeof window === 'undefined') return null
        if (audioContext === null) {
          const Ctor = window.AudioContext || window.webkitAudioContext
          if (typeof Ctor !== 'function') return null
          audioContext = new Ctor()
        }
        if (audioContext.state === 'suspended' && typeof audioContext.resume === 'function') {
          audioContext.resume().catch(function () { /* the next gesture retries */ })
        }
        return audioContext
      } catch (error) {
        return null
      }
    }

    function chimeNote(context, frequency, at, duration, type, peak) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = type
      oscillator.frequency.setValueAtTime(frequency, at)
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(peak, at + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(at)
      oscillator.stop(at + duration + 0.03)
    }

    /** Rising chime for Finished, falling chime for Incomplete. */
    function playCompletionSound(lane) {
      if (boardState.soundEnabled !== true) return
      const nowMs = Date.now()
      if (nowMs - lastChimeAt < 600) return
      const context = ensureAudioContext()
      if (context === null) return
      lastChimeAt = nowMs
      const start = context.currentTime + 0.03
      try {
        if (lane === 'done') {
          chimeNote(context, 880.0, start, 0.16, 'sine', 0.12)
          chimeNote(context, 1174.66, start + 0.14, 0.2, 'sine', 0.1)
        } else {
          chimeNote(context, 523.25, start, 0.18, 'triangle', 0.1)
          chimeNote(context, 392.0, start + 0.16, 0.26, 'triangle', 0.085)
        }
      } catch (error) {
        // An audio failure must never disturb the board.
      }
    }

    // ------------------------------------------------------------------
    // Header stats: remaining balance and today's usage
    // ------------------------------------------------------------------
    //
    // Balance is read from the installed dsh-api-dashboard route (the same
    // number its own cards show); when that route has no DeepSeek wallet the
    // core account remote is the fallback. Today's tokens and estimated spend
    // come from that plugin's `queryBalanceCost` session projection.

    async function fetchDashboardBalance() {
      try {
        if (typeof fetch !== 'function') return null
        const response = await fetch('/api-dashboard/balances?stale=1', { credentials: 'same-origin' })
        if (response === null || response === undefined || response.ok !== true) return null
        const data = await response.json()
        const list = data !== null && data !== undefined && Array.isArray(data.balances) ? data.balances : []
        const item = list.find(function (row) {
          return row !== null && row !== undefined && row.platform === 'deepseek'
        })
        if (!item || item.status !== 'ok') return null
        const amount = Number(item.total)
        if (!Number.isFinite(amount)) return null
        return { amount: amount, currency: String(item.currency || 'CNY'), source: 'dashboard' }
      } catch (error) {
        return null
      }
    }

    async function fetchAccountBalance() {
      try {
        if (moduleCtx === null || moduleCtx === undefined || typeof moduleCtx.get !== 'function') return null
        const remote = moduleCtx.get('remote')
        const account = remote !== null && remote !== undefined ? remote.account : undefined
        if (account === null || account === undefined || typeof account.getBalance !== 'function') return null
        const version = typeof window !== 'undefined' && window.__DSH_BOOT__ && typeof window.__DSH_BOOT__.version === 'string'
          ? window.__DSH_BOOT__.version
          : '0.0.0'
        const result = await account.getBalance({
          version: version,
          locale: activeLocaleOf(moduleLocale),
          timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
        })
        if (result === null || result === undefined || result.ok !== true) return null
        const details = result.value
        if (details === null || details === undefined || details.status !== 'ready') return null
        const wallets = []
        if (Array.isArray(details.value)) wallets.push.apply(wallets, details.value)
        if (Array.isArray(details.bonusWallets)) wallets.push.apply(wallets, details.bonusWallets)
        if (wallets.length === 0) return null
        const wallet = wallets.find(function (item) {
          return item !== null && item !== undefined && item.currency === 'CNY' && Number.isFinite(Number(item.balance))
        }) || wallets.find(function (item) {
          return item !== null && item !== undefined && Number.isFinite(Number(item.balance))
        })
        if (wallet === undefined || wallet === null) return null
        return { amount: Number(wallet.balance), currency: String(wallet.currency || 'CNY'), source: 'account' }
      } catch (error) {
        return null
      }
    }

    async function loadBalance() {
      const dashboard = await fetchDashboardBalance()
      if (dashboard !== null) return dashboard
      return fetchAccountBalance()
    }

    // ------------------------------------------------------------------
    // Session outcome tracking
    // ------------------------------------------------------------------
    //
    // The sidebar status store carries only `running` / `completionUnread` /
    // `pendingInteraction`; it cannot distinguish a normal finish from an
    // error or a user stop. The durable session event window can: the last
    // `turn/end` reason decides the lane. Only tracked sessions are retained,
    // and each is released right after its terminal lane is written.

    function getSessionsService() {
      try {
        if (moduleCtx === undefined || moduleCtx === null || typeof moduleCtx.get !== 'function') return undefined
        const service = moduleCtx.get('sessions')
        return service === null ? undefined : service
      } catch (error) {
        return undefined
      }
    }

    function lastTurnReason(window) {
      try {
        if (window === null || window === undefined || !Array.isArray(window.entries)) return undefined
        for (let index = window.entries.length - 1; index >= 0; index -= 1) {
          const entry = window.entries[index]
          if (entry === null || entry === undefined || entry.type !== 'event') continue
          const event = entry.event
          if (event === null || event === undefined || event.type !== 'turn/end') continue
          const reason = event.data !== null && event.data !== undefined ? event.data.reason : undefined
          if (reason !== null && reason !== undefined && typeof reason.kind === 'string') return reason.kind
        }
      } catch (error) {
        // A malformed window is treated as "unknown outcome".
      }
      return undefined
    }

    function createSessionTracker(sessionId, trackers) {
      if (trackers.has(sessionId)) return trackers.get(sessionId)
      if (trackers.size >= 12) return null
      const service = getSessionsService()
      if (service === undefined || typeof service.retain !== 'function') return null
      let reference
      try {
        reference = service.retain(sessionId, { source: 'controllerOperation' })
      } catch (error) {
        return null
      }
      const tracker = {
        id: sessionId,
        reference: reference,
        reason: undefined,
        error: null,
        ready: false,
        disposed: false,
        unsubscribe: null,
      }
      trackers.set(sessionId, tracker)
      Promise.resolve(reference.ready).then(function (binding) {
        if (tracker.disposed) return
        tracker.ready = true
        try {
          const session = binding.session
          const events = binding.eventSource
          const readReason = function () { tracker.reason = lastTurnReason(events.getSnapshot()) }
          const readError = function () {
            const snapshot = session.getSnapshot()
            tracker.error = snapshot !== null && snapshot !== undefined ? snapshot.lastAgentError : null
          }
          readReason()
          readError()
          const offEvents = events.subscribe(readReason)
          const offSession = session.subscribe(readError)
          tracker.unsubscribe = function () {
            try { offEvents() } catch (error) { /* ignore */ }
            try { offSession() } catch (error) { /* ignore */ }
          }
        } catch (error) {
          // Best effort.
        }
      }).catch(function () {
        tracker.ready = true
      })
      return tracker
    }

    function releaseSessionTracker(sessionId, trackers) {
      const tracker = trackers.get(sessionId)
      if (tracker === undefined) return
      trackers.delete(sessionId)
      tracker.disposed = true
      try {
        if (typeof tracker.unsubscribe === 'function') tracker.unsubscribe()
      } catch (error) {
        // ignore
      }
      try {
        if (typeof tracker.reference.release === 'function') tracker.reference.release()
      } catch (error) {
        // ignore
      }
    }

    /**
     * Reconcile running session cards: a session that started running gains a
     * card (unless the reader deleted it for this run), and labels follow the
     * session title. Terminal lanes are decided by the tracker, not here.
     */
    function syncSessionCards(tasks, rows, ignored) {
      let changed = false
      const next = tasks.slice()
      const findAuto = function (sessionId) {
        for (let index = 0; index < next.length; index += 1) {
          const task = next[index]
          if (task.source === 'session' && task.sessionId === sessionId && task.auto !== false) return index
        }
        return -1
      }
      rows.forEach(function (row) {
        const index = findAuto(row.id)
        if (row.running) {
          if (index === -1) {
            if (ignored.indexOf(row.id) !== -1) return
            const stamp = Date.now()
            next.push({
              id: uid(),
              title: row.title,
              status: 'running',
              createdAt: stamp,
              startedAt: stamp,
              source: 'session',
              sessionId: row.id,
              auto: true,
              tokens: row.tokens,
              tokenUsage: row.tokenUsage,
            })
            changed = true
            return
          }
          const card = next[index]
          let updated = card
          if (card.status !== 'running') {
            updated = { ...updated, status: 'running', startedAt: Date.now(), finishedAt: undefined, durationMs: undefined }
          }
          if (updated.title !== row.title) updated = { ...updated, title: row.title }
          if (updated.tokens !== row.tokens) updated = { ...updated, tokens: row.tokens }
          if (!sameTokenUsage(updated.tokenUsage, row.tokenUsage)) updated = { ...updated, tokenUsage: row.tokenUsage }
          if (updated !== card) {
            next[index] = updated
            changed = true
          }
          return
        }
        if (index === -1) return
        const card = next[index]
        let updated = card
        if (updated.title !== row.title) updated = { ...updated, title: row.title }
        if (updated.tokens !== row.tokens) updated = { ...updated, tokens: row.tokens }
        if (!sameTokenUsage(updated.tokenUsage, row.tokenUsage)) updated = { ...updated, tokenUsage: row.tokenUsage }
        if (updated !== card) {
          next[index] = updated
          changed = true
        }
      })
      return changed ? next : tasks
    }

    // ------------------------------------------------------------------
    // Icons
    // ------------------------------------------------------------------

    function IconBoard(iconProps) {
      const size = iconProps !== null && iconProps !== undefined && typeof iconProps.size === 'number' ? iconProps.size : 16
      return h('svg', {
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        focusable: false,
      }, [
        h('rect', { key: 'frame', x: 1.8, y: 2.2, width: 12.4, height: 11.6, rx: 2.2 }),
        h('path', { key: 'cols', d: 'M5.6 5.2v5.6M8 5.2v3.4M10.4 5.2v2.2' }),
      ])
    }

    function IconClose() {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: 11,
        height: 11,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        'aria-hidden': true,
        focusable: false,
      }, h('path', { d: 'M4.5 4.5l7 7M11.5 4.5l-7 7' }))
    }

    /** Folder glyph for the project-path field and the card path row. */
    function IconFolder() {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: 14,
        height: 14,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        focusable: false,
      }, [
        h('path', { key: 'body', d: 'M2 4.4c0-.8.6-1.4 1.4-1.4h2.5l1.3 1.5h5.4c.8 0 1.4.6 1.4 1.4v5.7c0 .8-.6 1.4-1.4 1.4H3.4c-.8 0-1.4-.6-1.4-1.4z' }),
        h('path', { key: 'lip', d: 'M2.2 6.4h11.5' }),
      ])
    }

    /** The left sidebar's panel glyph. */
    function PanelIcon(iconProps) {
      return IconBoard(iconProps)
    }

    function IconSoundOn() {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: 14,
        height: 14,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        focusable: false,
      }, [
        h('path', { key: 'body', d: 'M3 6.2h2.2L8.4 3.6v8.8L5.2 9.8H3z' }),
        h('path', { key: 'wave1', d: 'M10.4 5.7a3.1 3.1 0 0 1 0 4.6' }),
        h('path', { key: 'wave2', d: 'M12.3 4a5.2 5.2 0 0 1 0 8' }),
      ])
    }

    function IconSoundOff() {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: 14,
        height: 14,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        focusable: false,
      }, [
        h('path', { key: 'body', d: 'M3 6.2h2.2L8.4 3.6v8.8L5.2 9.8H3z' }),
        h('path', { key: 'slash', d: 'M10.3 6.2l3.4 3.6M13.7 6.2l-3.4 3.6' }),
      ])
    }

    function panelTitle() {
      return translate(dictFor(activeLocaleOf(moduleLocale)), 'title')
    }

    // ------------------------------------------------------------------
    // Controller: always mounted, drives the shared store
    // ------------------------------------------------------------------

    function MonitorController(props) {
      const autoSync = props !== null && props !== undefined
        && typeof props.useSessions === 'function'
        && typeof props.useSessionStatus === 'function'
      const sessionsState = autoSync ? props.useSessions(function (state) { return state }) : undefined
      const statusState = autoSync ? props.useSessionStatus(function (state) { return state }) : undefined

      useEffect(function () { setSyncAvailable(autoSync) }, [autoSync])

      const sessionRows = useMemo(function () {
        if (!autoSync) return []
        const byId = (sessionsState !== null && sessionsState !== undefined && sessionsState.byId) || {}
        const listed = sessionsState !== null && sessionsState !== undefined && Array.isArray(sessionsState.ids)
          ? sessionsState.ids
          : []
        const ids = listed.length > 0 ? listed : Object.keys(byId)
        const projections = (sessionsState !== null && sessionsState !== undefined && sessionsState.projectionsBySession) || {}
        const rows = []
        ids.forEach(function (id) {
          if (typeof id !== 'string' || id === '') return
          const view = byId[id] || {}
          const status = statusState !== null && statusState !== undefined && typeof statusState.get === 'function'
            ? statusState.get(id)
            : undefined
          const projection = projections[id]
          const tokenUsage = projection !== null && projection !== undefined && projection.values
            ? sumTokenUsage(projection.values.tokenUsage)
            : undefined
          rows.push({
            id: id,
            title: String(view.displayTitle || view.title || view.name || id),
            running: !!(view.running || (status !== null && status !== undefined && status.running)),
            tokens: tokenUsage === undefined ? undefined : tokenUsage.total,
            tokenUsage: tokenUsage,
          })
        })
        return rows
      }, [autoSync, sessionsState, statusState])

      const sessionSignature = useMemo(function () {
        return sessionRows.map(function (row) {
          return row.id + (row.running ? '+' : '-') + ':' + row.title + ':' + (row.tokens === undefined ? '' : row.tokens)
        }).join('|')
      }, [sessionRows])

      // Today's usage comes from the API dashboard's cost projection (same
      // value for every session): tokens across all sessions + spend by
      // currency. Absent when that plugin is not installed.
      const todayStats = useMemo(function () {
        if (!autoSync) return null
        const projections = (sessionsState !== null && sessionsState !== undefined && sessionsState.projectionsBySession) || {}
        const ids = Object.keys(projections)
        for (let index = 0; index < ids.length; index += 1) {
          const entry = projections[ids[index]]
          const view = entry !== null && entry !== undefined && entry.values ? entry.values.queryBalanceCost : undefined
          if (view === null || view === undefined || view.todayTokens === null || view.todayTokens === undefined) continue
          const tokens = view.todayTokens
          return {
            tokens: (Number(tokens.uncachedInput) || 0) + (Number(tokens.cacheRead) || 0)
              + (Number(tokens.cacheWrite) || 0) + (Number(tokens.output) || 0),
            byCurrency: view.todayByCurrency !== null && typeof view.todayByCurrency === 'object' ? view.todayByCurrency : {},
            day: typeof view.todayDay === 'string' ? view.todayDay : '',
          }
        }
        return null
      }, [autoSync, sessionsState])

      useEffect(function () {
        if (todayStats !== null) setBoardToday(todayStats)
      }, [todayStats])

      // Refresh the remaining balance periodically while the plugin is active.
      useEffect(function () {
        let stopped = false
        let timer = 0
        const tick = function () {
          if (stopped) return
          loadBalance().then(function (next) {
            if (stopped) return
            if (next !== null) setBoardBalance(next)
            timer = window.setTimeout(tick, next === null ? 15000 : 60000)
          }).catch(function () {
            if (!stopped) timer = window.setTimeout(tick, 30000)
          })
        }
        timer = window.setTimeout(tick, 1500)
        return function () {
          stopped = true
          window.clearTimeout(timer)
        }
      }, [])

      const rowsRef = useRef(sessionRows)
      rowsRef.current = sessionRows
      const trackersRef = useRef(new Map())
      const previousRunningRef = useRef(null)

      // Collect running sessions and keep the auto-cards' labels current.
      useEffect(function () {
        const rows = rowsRef.current
        if (rows.length === 0) return
        const ignored = boardSnapshot().ignored
        setBoardTasks(function (previous) { return syncSessionCards(previous, rows, ignored) })
        const runningIds = {}
        rows.forEach(function (row) { if (row.running) runningIds[row.id] = true })
        setBoardIgnored(function (previous) {
          const next = previous.filter(function (id) { return runningIds[id] === true })
          return next.length === previous.length ? previous : next
        })
      }, [sessionSignature])

      // Retain newly running sessions, and classify the ones that just stopped.
      useEffect(function () {
        const rows = rowsRef.current
        if (rows.length === 0) return
        const running = {}
        rows.forEach(function (row) { if (row.running) running[row.id] = true })
        Object.keys(running).forEach(function (id) { ensureTracker(id) })
        const previous = previousRunningRef.current
        if (previous === null) {
          boardSnapshot().tasks.filter(function (task) {
            return task.status === 'running' && task.source === 'session' && task.auto !== false
          }).forEach(function (task) {
            if (running[task.sessionId] !== true) finishTracked(task.sessionId, false)
          })
        } else {
          Object.keys(previous).forEach(function (id) {
            if (running[id] !== true) finishTracked(id, true)
          })
        }
        previousRunningRef.current = running
      }, [sessionSignature])

      // Release every retained session when the controller is disposed.
      useEffect(function () {
        return function () {
          const trackers = trackersRef.current
          Array.from(trackers.keys()).forEach(function (id) { releaseSessionTracker(id, trackers) })
        }
      }, [])

      function ensureTracker(id) {
        return createSessionTracker(id, trackersRef.current)
      }

      function finishCard(id, lane) {
        setBoardTasks(function (previous) {
          let changed = false
          const next = previous.map(function (task) {
            if (task.source !== 'session' || task.sessionId !== id || task.auto === false) return task
            if (task.status !== 'running') return task
            changed = true
            const stamp = Date.now()
            return {
              ...task,
              status: lane,
              finishedAt: stamp,
              durationMs: typeof task.startedAt === 'number' ? stamp - task.startedAt : undefined,
            }
          })
          return changed ? next : previous
        })
      }

      function finishTracked(id, notify) {
        const stillRunning = rowsRef.current.some(function (row) { return row.id === id && row.running })
        if (stillRunning) return
        let tracker = trackersRef.current.get(id)
        if (tracker === undefined) tracker = ensureTracker(id)
        if (tracker === null || tracker === undefined) {
          const hadCard = hasRunningSessionCard(id)
          finishCard(id, 'done')
          if (notify === true && hadCard) playCompletionSound('done')
          return
        }
        let settled = false
        const settle = function () {
          if (settled || tracker.disposed) return
          settled = true
          const nowRunning = rowsRef.current.some(function (row) { return row.id === id && row.running })
          if (nowRunning) return
          const reason = tracker.reason
          const error = tracker.error
          const failed = (reason !== undefined && reason !== 'completed')
            || (reason === undefined && typeof error === 'string' && error !== '')
          const lane = failed ? 'incomplete' : 'done'
          const hadCard = hasRunningSessionCard(id)
          finishCard(id, lane)
          if (notify === true && hadCard) playCompletionSound(lane)
          releaseSessionTracker(id, trackersRef.current)
        }
        // The sidebar's `running` flag and the durable `turn/end` event can
        // arrive in either order; a short beat avoids reading the previous
        // turn's reason.
        const settleSoon = function () { window.setTimeout(settle, 400) }
        if (tracker.ready) {
          settleSoon()
        } else {
          Promise.resolve(tracker.reference.ready).then(settleSoon).catch(function () {
            if (settled || tracker.disposed) return
            settled = true
            const hadCard = hasRunningSessionCard(id)
            finishCard(id, 'done')
            if (notify === true && hadCard) playCompletionSound('done')
            releaseSessionTracker(id, trackersRef.current)
          })
        }
      }

      /** Whether the board currently shows this session's running card. */
      function hasRunningSessionCard(id) {
        return boardSnapshot().tasks.some(function (task) {
          return task.source === 'session' && task.sessionId === id && task.auto !== false && task.status === 'running'
        })
      }

      return null
    }

    // ------------------------------------------------------------------
    // Board page (central panel)
    // ------------------------------------------------------------------

    function TaskBoardPage(props) {
      const locale = props !== null && props !== undefined && props.locale ? props.locale : moduleLocale
      const tr = useTranslator(locale)
      const board = useBoardState()
      const tasks = board.tasks
      const syncAvailable = board.syncAvailable
      const soundEnabled = board.soundEnabled !== false
      const balance = board.balance
      const today = board.today
      const recentPaths = board.recentPaths

      const [editing, setEditing] = useState(null)
      const [draft, setDraft] = useState('')
      const [draftPath, setDraftPath] = useState('')
      const [pathNote, setPathNote] = useState('')
      const [copiedId, setCopiedId] = useState(null)
      const [drag, setDrag] = useState(null)
      const [drop, setDrop] = useState(null)
      const [now, setNow] = useState(function () { return Date.now() })

      const tasksRef = useRef(tasks)
      tasksRef.current = tasks
      const editingRef = useRef(editing)
      editingRef.current = editing
      const dragRef = useRef(drag)
      dragRef.current = drag
      const cancelledRef = useRef(false)
      const laneRefs = useRef({})
      const pathInputRef = useRef(null)
      const folderInputRef = useRef(null)

      // Live clock for running cards only.
      useEffect(function () {
        const anyRunning = tasks.some(function (task) { return task.status === 'running' })
        if (!anyRunning) return undefined
        const handle = window.setInterval(function () { setNow(Date.now()) }, 1000)
        return function () { window.clearInterval(handle) }
      }, [tasks])

      // The pick note and the "copied" confirmation are transient.
      useEffect(function () {
        if (pathNote === '') return undefined
        const handle = window.setTimeout(function () { setPathNote('') }, 7000)
        return function () { window.clearTimeout(handle) }
      }, [pathNote])

      useEffect(function () {
        if (copiedId === null) return undefined
        const handle = window.setTimeout(function () { setCopiedId(null) }, 1200)
        return function () { window.clearTimeout(handle) }
      }, [copiedId])

      // Escape cancels a card drag or an inline rename.
      useEffect(function () {
        function onKeyDown(event) {
          if (event.key !== 'Escape') return
          if (dragRef.current !== null) {
            cancelledRef.current = true
            setDrag(null)
            setDrop(null)
          } else if (editingRef.current !== null) {
            editingRef.current = null
            setEditing(null)
          }
        }
        window.addEventListener('keydown', onKeyDown, true)
        return function () { window.removeEventListener('keydown', onKeyDown, true) }
      }, [])

      // ----------------------------------------------------------------
      // Pointer drag
      // ----------------------------------------------------------------

      function beginPointerDrag(event, onMove, onEnd) {
        if (typeof event.button === 'number' && event.button !== 0) return false
        event.preventDefault()
        const previousSelect = document.body.style.userSelect
        document.body.style.userSelect = 'none'
        function move(pointerEvent) { onMove(pointerEvent) }
        function finish(pointerEvent) {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', finish)
          window.removeEventListener('pointercancel', finish)
          document.body.style.userSelect = previousSelect
          try {
            onEnd(pointerEvent)
          } catch (error) {
            // A gesture must never break the panel.
          }
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', finish)
        window.addEventListener('pointercancel', finish)
        return true
      }

      function isInteractive(node) {
        if (node === null || node === undefined || typeof node.closest !== 'function') return false
        return node.closest('button, input, textarea, select, a') !== null
      }

      function laneAtPoint(x, y) {
        for (let index = 0; index < LANE_IDS.length; index += 1) {
          const column = laneRefs.current[LANE_IDS[index]]
          if (!column) continue
          const box = column.getBoundingClientRect()
          if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return LANE_IDS[index]
        }
        return null
      }

      function insertionIndex(lane, clientY, draggedId) {
        const column = laneRefs.current[lane]
        if (!column) return 0
        const cards = column.querySelectorAll('[data-tm-task-id]')
        let index = 0
        for (let position = 0; position < cards.length; position += 1) {
          const node = cards[position]
          if (node.getAttribute('data-tm-task-id') === draggedId) continue
          const box = node.getBoundingClientRect()
          if (clientY < box.top + box.height / 2) return index
          index += 1
        }
        return index
      }

      function autoScrollLane(lane, clientY) {
        const column = laneRefs.current[lane]
        if (!column) return
        const list = column.querySelector('[data-tm-list]')
        if (!list) return
        const box = list.getBoundingClientRect()
        if (clientY < box.top + 24) list.scrollTop -= 10
        else if (clientY > box.bottom - 24) list.scrollTop += 10
      }

      function onCardPointerDown(task, event) {
        if (event.button !== 0) return
        if (isInteractive(event.target)) return
        const startX = event.clientX
        const startY = event.clientY
        const cardBox = event.currentTarget.getBoundingClientRect()
        const cardWidth = cardBox.width
        const cardTitle = task.title
        let started = false
        let pendingDrop = null
        cancelledRef.current = false
        beginPointerDrag(event, function (pointerEvent) {
          if (!started) {
            if (Math.abs(pointerEvent.clientX - startX) + Math.abs(pointerEvent.clientY - startY) < 5) return
            started = true
            document.body.style.cursor = 'grabbing'
            setDrag({
              id: task.id,
              lane: task.status,
              x: pointerEvent.clientX,
              y: pointerEvent.clientY,
              width: cardWidth,
              title: cardTitle,
            })
            pendingDrop = { lane: task.status, index: insertionIndex(task.status, pointerEvent.clientY, task.id) }
            setDrop(pendingDrop)
          }
          setDrag(function (current) {
            return current === null ? current : { ...current, x: pointerEvent.clientX, y: pointerEvent.clientY }
          })
          const lane = laneAtPoint(pointerEvent.clientX, pointerEvent.clientY)
          if (lane !== null) {
            autoScrollLane(lane, pointerEvent.clientY)
            const index = insertionIndex(lane, pointerEvent.clientY, task.id)
            if (pendingDrop === null || pendingDrop.lane !== lane || pendingDrop.index !== index) {
              pendingDrop = { lane: lane, index: index }
              setDrop(pendingDrop)
            }
          }
        }, function () {
          document.body.style.cursor = ''
          const target = pendingDrop
          if (started && target !== null && !cancelledRef.current) {
            moveTask(task.id, target.lane, target.index)
          }
          started = false
          pendingDrop = null
          cancelledRef.current = false
          setDrag(null)
          setDrop(null)
        })
      }

      // ----------------------------------------------------------------
      // Board mutations (no task creation: the controller owns that)
      // ----------------------------------------------------------------

      /** Add a project of your own; it stays in Queued (the session sync never touches it). */
      function addProject() {
        const title = draft.trim().slice(0, 200)
        if (title === '') return
        const path = normalizePath(draftPath)
        const task = { id: uid(), title: title, status: 'queued', createdAt: Date.now() }
        if (path !== '') task.path = path
        setBoardTasks(function (previous) {
          const next = previous.concat([task])
          return next.length > MAX_TASKS ? next.slice(next.length - MAX_TASKS) : next
        })
        setDraft('')
        setDraftPath('')
        setPathNote('')
        if (path !== '') rememberRecentPath(path)
      }

      /** A folder picker that never lies: `/`-aware, and it says when the
       *  browser can only hand back a folder name (no absolute path). */
      function pickFolder() {
        const picker = typeof window !== 'undefined' ? window.showDirectoryPicker : undefined
        if (typeof picker === 'function') {
          let pending = null
          try {
            pending = picker.call(window, { mode: 'read' })
          } catch (error) {
            pending = null
          }
          if (pending !== null && pending !== undefined && typeof pending.then === 'function') {
            pending.then(function (handle) {
              if (handle !== null && handle !== undefined && typeof handle.name === 'string') applyPickedFolder(handle.name)
            }, function (error) {
              if (error !== null && error !== undefined && error.name === 'AbortError') return
              openFolderInput()
            })
            return
          }
        }
        openFolderInput()
      }

      /** Fallback for browsers without the directory picker: a directory input. */
      function openFolderInput() {
        const node = folderInputRef.current
        if (node === null || node === undefined) {
          if (pathInputRef.current !== null && pathInputRef.current !== undefined) pathInputRef.current.focus()
          return
        }
        node.click()
      }

      function onFolderInputChange(event) {
        const files = event.target.files
        let name = ''
        if (files !== null && files !== undefined && files.length > 0) {
          const relative = String(files[0].webkitRelativePath || '')
          name = relative.split('/')[0] || String(files[0].name || '')
        }
        try { event.target.value = '' } catch (error) { /* ignore */ }
        if (name !== '') applyPickedFolder(name)
      }

      /**
       * Browsers deliberately hide absolute paths, so a picked folder yields
       * its name only: it is appended to whatever prefix the reader typed and
       * the note asks them to complete the rest. A typed path is never
       * overwritten — the picker only fills or extends it.
       */
      function applyPickedFolder(name) {
        const value = String(name || '').trim()
        if (value === '') return
        setDraftPath(function (current) {
          const text = String(current || '').trim()
          if (text === '') return value
          const last = text.charAt(text.length - 1)
          if (last === '/' || last === '\\') return text + value
          const tail = text.split(/[\\/]/).pop()
          return tail === value ? text : text + '/' + value
        })
        setPathNote(tr('pathNote', { name: value }))
        if (pathInputRef.current !== null && pathInputRef.current !== undefined) pathInputRef.current.focus()
      }

      function copyTaskPath(task) {
        const text = String(task.path || '')
        if (text === '') return
        copyText(text).then(function (ok) {
          if (ok === true) setCopiedId(task.id)
        })
      }

      function openPathEditor(task) {
        setEditing({ id: task.id, field: 'path', value: String(task.path || '') })
      }

      function removeTask(id) {
        const task = tasksRef.current.filter(function (item) { return item.id === id })[0]
        if (task !== undefined && task.sessionId) {
          setBoardIgnored(function (previous) {
            return previous.indexOf(task.sessionId) === -1 ? previous.concat([task.sessionId]) : previous
          })
        }
        setBoardTasks(function (previous) {
          return previous.filter(function (item) { return item.id !== id })
        })
      }

      function clearDone() {
        setBoardTasks(function (previous) {
          return previous.filter(function (task) { return task.status !== 'done' })
        })
      }

      function moveTask(id, lane, indexInLane) {
        setBoardTasks(function (previous) {
          const task = previous.filter(function (item) { return item.id === id })[0]
          if (task === undefined) return previous
          const rest = previous.filter(function (item) { return item.id !== id })
          const stamp = Date.now()
          const next = { ...task, status: lane }
          // A reader's lane change takes the card over from the live sync;
          // reordering inside its own lane keeps it auto-tracked.
          if (next.sessionId && lane !== task.status) next.auto = false
          if (lane === 'queued') {
            next.startedAt = undefined
            next.finishedAt = undefined
            next.durationMs = undefined
          } else if (lane === 'running') {
            next.startedAt = typeof task.startedAt === 'number' ? task.startedAt : stamp
            next.finishedAt = undefined
            next.durationMs = undefined
          } else {
            next.finishedAt = stamp
            next.durationMs = typeof task.startedAt === 'number' ? stamp - task.startedAt : undefined
          }
          const members = rest.filter(function (item) { return item.status === lane })
          const clamped = Math.max(0, Math.min(indexInLane, members.length))
          let insertAt = rest.length
          if (clamped < members.length) insertAt = rest.indexOf(members[clamped])
          else if (members.length > 0) insertAt = rest.indexOf(members[members.length - 1]) + 1
          const nextTasks = rest.slice()
          nextTasks.splice(insertAt, 0, next)
          return nextTasks
        })
      }

      function commitEdit(id) {
        const current = editingRef.current
        if (current === null || current.id !== id) return
        editingRef.current = null
        setEditing(null)
        // Two inline editors share one state: the title and the project path.
        if (current.field === 'path') {
          const path = normalizePath(current.value)
          setBoardTasks(function (previous) {
            return previous.map(function (task) {
              if (task.id !== id) return task
              const next = { ...task }
              if (path === '') delete next.path
              else next.path = path
              return next
            })
          })
          if (path !== '') rememberRecentPath(path)
          return
        }
        const title = String(current.value || '').trim().slice(0, 200)
        if (title === '') return
        setBoardTasks(function (previous) {
          return previous.map(function (task) {
            return task.id === id ? { ...task, title: title } : task
          })
        })
      }

      // ----------------------------------------------------------------
      // Rendering
      // ----------------------------------------------------------------

      function cardMeta(task) {
        if (task.status === 'running') {
          const since = typeof task.startedAt === 'number' ? task.startedAt : task.createdAt
          return tr('runningMeta', { time: elapsedText(now - since) })
        }
        if (task.status === 'done') {
          const finished = tr('finishedMeta', { time: clockTime(task.finishedAt || task.createdAt) })
          return typeof task.durationMs === 'number'
            ? finished + ' ' + tr('tookMeta', { time: elapsedText(task.durationMs) })
            : finished
        }
        if (task.status === 'incomplete') {
          const stopped = tr('stoppedMeta', { time: clockTime(task.finishedAt || task.createdAt) })
          return typeof task.durationMs === 'number'
            ? stopped + ' ' + tr('tookMeta', { time: elapsedText(task.durationMs) })
            : stopped
        }
        return tr('createdMeta', { time: clockTime(task.createdAt) })
      }

      function tokenTitle(task) {
        const usage = task.tokenUsage
        if (usage === null || usage === undefined) return tr('tokensHint', { total: formatTokens(task.tokens) })
        return tr('tokensBreakdown', {
          total: formatTokens(usage.total),
          input: formatTokens(usage.input),
          output: formatTokens(usage.output),
          read: formatTokens(usage.cacheRead),
          write: formatTokens(usage.cacheWrite),
        })
      }

      function renderCard(task) {
        const dragging = drag !== null && drag.id === task.id
        const tone = LANE_META[task.status] !== undefined ? LANE_META[task.status].tone : 'var(--dsw-alias-label-secondary)'
        const isEditingTitle = editing !== null && editing.id === task.id && editing.field !== 'path'
        const isEditingPath = editing !== null && editing.id === task.id && editing.field === 'path'
        const hasPath = typeof task.path === 'string' && task.path !== ''
        return h('div', {
          key: task.id,
          className: 'tm-card' + (dragging ? ' tm-card--dragging' : ''),
          'data-tm-task-id': task.id,
          style: { '--tm-tone': tone },
          onPointerDown: function (event) { onCardPointerDown(task, event) },
        }, [
          h('div', { key: 'top', className: 'tm-card-top' }, [
            isEditingTitle
              ? h('input', {
                  key: 'edit',
                  className: 'tm-edit',
                  type: 'text',
                  value: editing.value,
                  autoFocus: true,
                  maxLength: 200,
                  'aria-label': tr('rename'),
                  onChange: function (event) {
                    setEditing({ id: task.id, field: 'title', value: event.target.value })
                  },
                  onKeyDown: function (event) {
                    event.stopPropagation()
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      commitEdit(task.id)
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      editingRef.current = null
                      setEditing(null)
                    }
                  },
                  onBlur: function () { commitEdit(task.id) },
                  onPointerDown: function (event) { event.stopPropagation() },
                })
              : h('span', {
                  key: 'title',
                  className: 'tm-card-title',
                  title: task.title,
                  onDoubleClick: function () { setEditing({ id: task.id, field: 'title', value: task.title }) },
                }, task.title),
            h('button', {
              key: 'remove',
              type: 'button',
              className: 'tm-icon tm-remove',
              'aria-label': tr('remove'),
              title: tr('remove'),
              onClick: function (event) {
                event.stopPropagation()
                removeTask(task.id)
              },
            }, h(IconClose)),
          ]),
          hasPath || isEditingPath || !task.sessionId
            ? h('div', { key: 'pathrow', className: 'tm-card-pathrow' }, [
                isEditingPath
                  ? h('input', {
                      key: 'pathEdit',
                      className: 'tm-edit tm-edit--path',
                      type: 'text',
                      value: editing.value,
                      autoFocus: true,
                      maxLength: PATH_MAX,
                      placeholder: tr('pathPlaceholder'),
                      'aria-label': tr('pathEditTitle'),
                      onChange: function (event) {
                        setEditing({ id: task.id, field: 'path', value: event.target.value })
                      },
                      onKeyDown: function (event) {
                        event.stopPropagation()
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          commitEdit(task.id)
                        } else if (event.key === 'Escape') {
                          event.preventDefault()
                          editingRef.current = null
                          setEditing(null)
                        }
                      },
                      onBlur: function () { commitEdit(task.id) },
                      onPointerDown: function (event) { event.stopPropagation() },
                    })
                  : hasPath
                    ? h('button', {
                        key: 'path',
                        type: 'button',
                        className: 'tm-card-path' + (copiedId === task.id ? ' tm-card-path--copied' : ''),
                        title: task.path + '\n' + tr('pathCopyTitle') + ' · ' + tr('pathEditTitle'),
                        onClick: function (event) {
                          event.stopPropagation()
                          copyTaskPath(task)
                        },
                        onDoubleClick: function (event) {
                          event.stopPropagation()
                          openPathEditor(task)
                        },
                        onPointerDown: function (event) { event.stopPropagation() },
                      }, [
                        h('span', { key: 'icon', className: 'tm-card-path-icon', 'aria-hidden': true }, h(IconFolder)),
                        h('span', { key: 'text', className: 'tm-card-path-text' },
                          copiedId === task.id ? tr('pathCopied') : shortPath(task.path)),
                      ])
                    : h('button', {
                        key: 'pathAdd',
                        type: 'button',
                        className: 'tm-path-add',
                        title: tr('pathEditTitle'),
                        onClick: function (event) {
                          event.stopPropagation()
                          openPathEditor(task)
                        },
                        onPointerDown: function (event) { event.stopPropagation() },
                      }, '+ ' + tr('pathAdd')),
              ])
            : null,
          h('div', {
            key: 'meta',
            className: 'tm-card-meta' + (task.status === 'running' ? ' tm-card-meta--running' : ''),
          }, [
            task.sessionId
              ? h('span', { key: 'tag', className: 'tm-tag', title: tr('syncHint') }, tr('sessionTag'))
              : h('span', { key: 'tag', className: 'tm-tag' }, tr('projectTag')),
            h('span', { key: 'text', className: 'tm-meta-text' }, cardMeta(task)),
            typeof task.tokens === 'number' && task.tokens > 0
              ? h('span', {
                  key: 'tokens',
                  className: 'tm-tokens',
                  title: tokenTitle(task),
                }, '· ' + formatTokens(task.tokens) + ' ' + tr('tokensSuffix'))
              : null,
          ]),
        ])
      }

      function renderLane(lane) {
        const meta = LANE_META[lane]
        const laneTasks = tasks.filter(function (task) { return task.status === lane })
        const over = drop !== null && drop.lane === lane
        const children = []
        children.push(h('div', { key: 'head', className: 'tm-lane-head' }, [
          h('span', { key: 'dot', className: 'tm-dot', style: { background: meta.tone }, 'aria-hidden': true }),
          h('span', { key: 'name', className: 'tm-lane-name' }, tr(meta.key)),
          h('span', { key: 'count', className: 'tm-lane-count' }, String(laneTasks.length)),
        ]))
        const listChildren = []
        let nonDragged = 0
        laneTasks.forEach(function (task) {
          const isDragged = drag !== null && drag.id === task.id
          if (over && !isDragged && drop.index === nonDragged) {
            listChildren.push(h('div', { key: 'drop-' + lane + '-' + nonDragged, className: 'tm-drop', 'aria-hidden': true }))
          }
          listChildren.push(renderCard(task))
          if (!isDragged) nonDragged += 1
        })
        if (over && drop.index >= nonDragged) {
          listChildren.push(h('div', { key: 'drop-end', className: 'tm-drop', 'aria-hidden': true }))
        }
        if (laneTasks.length === 0 && !over) {
          listChildren.push(h('div', { key: 'empty', className: 'tm-empty' }, tr('empty')))
        }
        children.push(h('div', {
          key: 'list',
          className: 'tm-list',
          'data-tm-list': '',
        }, listChildren))
        return h('div', {
          key: lane,
          className: 'tm-lane' + (over ? ' tm-lane--over' : ''),
          ref: function (node) {
            if (node) laneRefs.current[lane] = node
            else delete laneRefs.current[lane]
          },
        }, children)
      }

      const runningCount = tasks.filter(function (task) { return task.status === 'running' }).length
      const doneCount = tasks.filter(function (task) { return task.status === 'done' }).length
      const subtitleText = runningCount > 0
        ? tr('subtitle', { total: tasks.length, running: runningCount })
        : tr('subtitleIdle', { total: tasks.length })

      const ghost = drag === null ? null : h('div', {
        key: 'ghost',
        className: 'tm-ghost',
        'aria-hidden': true,
        style: {
          left: Math.min(drag.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1280) - 260),
          top: drag.y - 20,
          width: Math.min(Math.max(170, drag.width - 6), 260),
        },
      }, h('span', { key: 'title', className: 'tm-ghost-title' }, drag.title))

      return h(React.Fragment, null,
        h('style', { key: 'style', dangerouslySetInnerHTML: { __html: CSS } }),
        h('div', { key: 'page', className: 'tm-root tm-page', 'data-tm-page': '', 'aria-label': tr('title') }, [
          h('div', { key: 'top', className: 'tm-page-top' }, [
            h('div', { key: 'stats', className: 'tm-stats', role: 'group', 'aria-label': tr('title') }, [
              h('span', { key: 'balance', className: 'tm-stat', title: tr('balanceTitle') }, [
                h('span', { key: 'label', className: 'tm-stat-label' }, tr('balanceLabel')),
                h('span', { key: 'value', className: 'tm-stat-value' },
                  balance !== null && balance !== undefined ? formatMoney(balance.amount, balance.currency) : '—'),
              ]),
              h('span', { key: 'todayTokens', className: 'tm-stat', title: tr('todayTokensTitle') }, [
                h('span', { key: 'label', className: 'tm-stat-label' }, tr('todayLabel')),
                h('span', { key: 'value', className: 'tm-stat-value' },
                  today !== null && today !== undefined ? formatTokens(today.tokens) + ' ' + tr('tokensSuffix') : '—'),
              ]),
              h('span', { key: 'todayCost', className: 'tm-stat', title: tr('todayCostTitle') }, [
                h('span', { key: 'label', className: 'tm-stat-label' }, tr('todayLabel')),
                h('span', { key: 'value', className: 'tm-stat-value' },
                  today !== null && today !== undefined ? formatTodayMoney(today) : '—'),
              ]),
            ]),
            h('div', { key: 'actions', className: 'tm-top-actions' }, [
              h('span', {
                key: 'sync',
                className: 'tm-sync' + (syncAvailable ? ' tm-sync--on' : ' tm-sync--off'),
                title: syncAvailable ? tr('syncHint') : tr('syncOff'),
                'aria-label': syncAvailable ? tr('syncOn') : tr('syncOff'),
              }, [
                h('span', { key: 'dot', className: 'tm-sync-dot', 'aria-hidden': true }),
                h('span', { key: 'label', className: 'tm-sync-label' }, syncAvailable ? tr('syncOn') : tr('syncOff')),
              ]),
              h('button', {
                key: 'sound',
                type: 'button',
                className: 'tm-icon tm-sound',
                title: soundEnabled ? tr('soundOn') : tr('soundOff'),
                'aria-label': soundEnabled ? tr('soundOn') : tr('soundOff'),
                'aria-pressed': soundEnabled ? 'true' : 'false',
                onClick: function () { setSoundEnabled(!soundEnabled) },
              }, soundEnabled ? h(IconSoundOn) : h(IconSoundOff)),
            ]),
          ]),
          h('div', { key: 'head', className: 'tm-page-head' }, [
            h('span', { key: 'pulse', className: 'tm-pulse', 'aria-hidden': true }),
            h('div', { key: 'titles', className: 'tm-titles' }, [
              h('div', { key: 'title', className: 'tm-title' }, tr('title')),
              h('div', { key: 'sub', className: 'tm-subtitle' }, subtitleText),
            ]),
          ]),
          h('div', { key: 'body', className: 'tm-page-body' }, LANE_IDS.map(renderLane)),
          h('div', { key: 'foot', className: 'tm-page-foot' }, [
            h('form', {
              key: 'add',
              className: 'tm-add-project',
              onSubmit: function (event) { event.preventDefault(); addProject() },
            }, [
              h('input', {
                key: 'input',
                className: 'tm-input tm-input--name',
                type: 'text',
                value: draft,
                maxLength: 200,
                placeholder: tr('addProjectPlaceholder'),
                'aria-label': tr('addProjectPlaceholder'),
                onChange: function (event) { setDraft(event.target.value) },
              }),
              h('div', { key: 'path', className: 'tm-path-field' }, [
                h('input', {
                  key: 'pathInput',
                  ref: pathInputRef,
                  className: 'tm-input tm-input--path',
                  type: 'text',
                  value: draftPath,
                  maxLength: PATH_MAX,
                  list: 'tm-recent-paths',
                  placeholder: tr('pathPlaceholder'),
                  'aria-label': tr('pathPlaceholder'),
                  title: tr('pathPickHint'),
                  onChange: function (event) { setDraftPath(event.target.value) },
                }),
                h('button', {
                  key: 'pick',
                  type: 'button',
                  className: 'tm-icon tm-pick',
                  title: tr('pathPickTitle'),
                  'aria-label': tr('pathPickTitle'),
                  onClick: pickFolder,
                }, h(IconFolder)),
                h('input', {
                  key: 'folderInput',
                  ref: folderInputRef,
                  className: 'tm-folder-input',
                  type: 'file',
                  multiple: true,
                  tabIndex: -1,
                  'aria-hidden': true,
                  onChange: onFolderInputChange,
                  webkitdirectory: '',
                  directory: '',
                }),
                h('datalist', { key: 'recent', id: 'tm-recent-paths' },
                  recentPaths.map(function (item) { return h('option', { key: item, value: item }) })),
              ]),
              h('button', {
                key: 'submit',
                className: 'tm-primary',
                type: 'submit',
                disabled: draft.trim() === '',
              }, tr('addProject')),
            ]),
            pathNote !== ''
              ? h('span', { key: 'note', className: 'tm-note', role: 'status' }, pathNote)
              : null,
            h('span', { key: 'hint', className: 'tm-foot-hint', title: tr('syncHint') }, tr('pageHint')),
            doneCount > 0
              ? h('button', {
                  key: 'clear',
                  type: 'button',
                  className: 'tm-link',
                  onClick: clearDone,
                }, tr('clearFinished'))
              : null,
          ]),
        ]),
        ghost,
      )
    }

    // ------------------------------------------------------------------
    // Retired right-sidebar tab: a short migration notice instead of a dead
    // tab left over from the previous placement.
    // ------------------------------------------------------------------

    function MigrationBody(props) {
      const locale = props !== null && props !== undefined && props.locale ? props.locale : moduleLocale
      const tr = useTranslator(locale)
      function openBoard() {
        try {
          const layout = moduleCtx !== undefined && moduleCtx !== null && typeof moduleCtx.get === 'function'
            ? moduleCtx.get('layout')
            : undefined
          if (layout !== null && layout !== undefined && typeof layout.selectPanel === 'function') {
            layout.selectPanel(PANEL_ID)
          }
        } catch (error) {
          // The notice stays readable even when navigation is unavailable.
        }
      }
      return h(React.Fragment, null,
        h('style', { key: 'style', dangerouslySetInnerHTML: { __html: CSS } }),
        h('div', { key: 'migrate', className: 'tm-root tm-migrate' }, [
          h('div', { key: 'title', className: 'tm-migrate-title' }, tr('movedTitle')),
          h('div', { key: 'text', className: 'tm-migrate-text' }, tr('movedBody')),
          h('button', { key: 'open', type: 'button', className: 'tm-primary', onClick: openBoard }, tr('movedOpen')),
        ]),
      )
    }

    // ------------------------------------------------------------------
    // Styles (scoped; theme tokens only)
    // ------------------------------------------------------------------

    const CSS = [
      '.tm-root, .tm-root * { box-sizing: border-box; }',
      '.tm-root { font-family: inherit; color: var(--dsw-alias-label-primary); }',
      '.tm-page { display: flex; flex-direction: column; gap: 10px; width: 100%; height: 100%; min-height: 0;',
      '  padding: 14px 16px 12px; font-size: 12.5px; line-height: 1.42; background: transparent; }',
      '.tm-page-head { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; min-width: 0; }',
      '.tm-page-top { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; min-width: 0; flex-wrap: wrap; }',
      '.tm-stats { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }',
      '.tm-stat { display: inline-flex; align-items: baseline; gap: 5px; padding: 3px 9px; border-radius: 999px;',
      '  background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); }',
      '.tm-stat-label { font-size: 10px; color: var(--dsw-alias-label-secondary); }',
      '.tm-stat-value { font-size: 11.5px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }',
      '.tm-top-actions { margin-left: auto; display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }',
      '.tm-top-actions .tm-sync { margin-left: 0; }',
      '.tm-pulse { position: relative; width: 8px; height: 8px; border-radius: 999px; flex: 0 0 auto;',
      '  background: var(--dsw-alias-brand-primary); }',
      '.tm-pulse::after { content: ""; position: absolute; inset: -4px; border-radius: 999px;',
      '  border: 1px solid var(--dsw-alias-brand-primary); opacity: 0.6; animation: tm-ping 2.6s ease-out infinite; }',
      '@keyframes tm-ping { 0% { transform: scale(0.55); opacity: 0.55; } 70%, 100% { transform: scale(1.35); opacity: 0; } }',
      '.tm-titles { min-width: 0; display: flex; flex-direction: column; gap: 1px; }',
      '.tm-title { font-size: 13.5px; font-weight: 600; letter-spacing: 0.01em; }',
      '.tm-subtitle { font-size: 11px; color: var(--dsw-alias-label-secondary); }',
      '.tm-sync { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto; }',
      '.tm-sync-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--dsw-alias-state-success-primary); }',
      '.tm-sync--off .tm-sync-dot { background: var(--dsw-alias-label-secondary); opacity: 0.6; }',
      '.tm-sync-label { font-size: 11px; color: var(--dsw-alias-label-secondary); }',
      '.tm-sound { width: 26px; height: 26px; }',
      '.tm-page-body { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }',
      '.tm-lane { display: flex; flex-direction: column; min-width: 0; min-height: 0; gap: 6px; padding: 8px;',
      '  background: var(--dsw-alias-bg-layer-1); border: 1px solid transparent; border-radius: 10px;',
      '  transition: border-color 120ms ease; }',
      '.tm-lane--over { border-color: var(--dsw-alias-brand-primary); }',
      '.tm-lane-head { display: flex; align-items: center; gap: 6px; padding: 1px 3px 0; flex: 0 0 auto; }',
      '.tm-dot { width: 7px; height: 7px; border-radius: 999px; flex: 0 0 auto; }',
      '.tm-lane-name { font-size: 11.5px; font-weight: 600; color: var(--dsw-alias-label-secondary);',
      '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '.tm-lane-count { margin-left: auto; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px;',
      '  display: grid; place-items: center; font-size: 10.5px; font-variant-numeric: tabular-nums;',
      '  color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); }',
      '.tm-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; display: flex;',
      '  flex-direction: column; gap: 6px; padding: 1px 2px 4px; scrollbar-width: thin; }',
      '.tm-list::-webkit-scrollbar { width: 8px; }',
      '.tm-list::-webkit-scrollbar-thumb { background: var(--dsw-alias-border-l2); border-radius: 8px; }',
      '.tm-list::-webkit-scrollbar-track { background: transparent; }',
      '.tm-card { position: relative; display: flex; flex-direction: column; gap: 5px; padding: 8px 7px 8px 11px;',
      '  background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px;',
      '  cursor: grab; user-select: none; touch-action: none; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);',
      '  transition: border-color 120ms ease, opacity 120ms ease; }',
      '.tm-card::before { content: ""; position: absolute; left: 0; top: 7px; bottom: 7px; width: 2.5px;',
      '  border-radius: 2px; background: var(--tm-tone); opacity: 0.9; }',
      '.tm-card:hover { border-color: var(--dsw-alias-border-l2); }',
      '.tm-card:active { cursor: grabbing; }',
      '.tm-card--dragging { opacity: 0.34; }',
      '.tm-card-top { display: flex; align-items: flex-start; gap: 4px; }',
      '.tm-card-title { flex: 1 1 auto; min-width: 0; font-size: 12px; padding-left: 2px; word-break: break-word; white-space: pre-wrap; }',
      '.tm-card-pathrow { padding-left: 2px; min-width: 0; }',
      '.tm-edit--path { width: 100%; font-size: 10.5px; padding: 1px 5px; }',
      '.tm-card-path { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 0;',
      '  border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit;',
      '  font-size: 10.5px; cursor: pointer; text-align: left; }',
      '.tm-card-path:hover { color: var(--dsw-alias-label-primary); }',
      '.tm-card-path--copied { color: var(--dsw-alias-state-success-primary); }',
      '.tm-card-path-icon { display: inline-flex; flex: 0 0 auto; opacity: 0.85; }',
      '.tm-card-path-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.tm-path-add { padding: 0 2px; border: 0; background: transparent; color: var(--dsw-alias-label-secondary);',
      '  font: inherit; font-size: 10px; cursor: pointer; opacity: 0.7; }',
      '.tm-path-add:hover { opacity: 1; color: var(--dsw-alias-label-primary); }',
      '.tm-card-meta { padding-left: 2px; display: flex; align-items: center; gap: 5px; flex-wrap: wrap;',
      '  font-size: 10.5px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }',
      '.tm-meta-text { min-width: 0; }',
      '.tm-tokens { color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; white-space: nowrap; }',
      '.tm-tag { display: inline-flex; align-items: center; height: 14px; padding: 0 4px; border-radius: 4px;',
      '  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary);',
      '  font-size: 9.5px; line-height: 1; white-space: nowrap; }',
      '.tm-card-meta--running { color: var(--dsw-alias-brand-primary); }',
      '.tm-remove { width: 20px; height: 20px; flex: 0 0 auto; opacity: 0; transition: opacity 120ms ease; }',
      '.tm-card:hover .tm-remove, .tm-card:focus-within .tm-remove { opacity: 1; }',
      '.tm-icon { display: grid; place-items: center; width: 20px; height: 20px; padding: 0; border: 0;',
      '  border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }',
      '.tm-icon:hover { background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); }',
      '.tm-icon:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }',
      '.tm-edit { flex: 1 1 auto; min-width: 0; font: inherit; font-size: 12px; color: var(--dsw-alias-label-primary);',
      '  background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-brand-primary);',
      '  border-radius: 5px; padding: 1px 5px; outline: none; }',
      '.tm-drop { flex: 0 0 auto; height: 2px; margin: 1px 2px; border-radius: 2px;',
      '  background: var(--dsw-alias-brand-primary); opacity: 0.9; box-shadow: 0 0 8px var(--dsw-alias-brand-primary); }',
      '.tm-empty { margin: auto 0; padding: 14px 0; text-align: center; font-size: 11px;',
      '  color: var(--dsw-alias-label-secondary); opacity: 0.7; }',
      '.tm-page-foot { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; row-gap: 6px;',
      '  padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l1); }',
      '.tm-add-project { display: flex; align-items: center; gap: 6px; flex: 1 1 auto; min-width: 240px; margin: 0; }',
      '.tm-input { flex: 1 1 auto; min-width: 0; height: 30px; padding: 0 9px; border-radius: 7px;',
      '  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base);',
      '  color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; outline: none; }',
      '.tm-input--name { flex: 0 1 210px; min-width: 120px; }',
      '.tm-path-field { position: relative; display: flex; align-items: center; gap: 4px;',
      '  flex: 1 1 300px; min-width: 180px; }',
      '.tm-input--path { flex: 1 1 auto; }',
      '.tm-pick { width: 30px; height: 30px; flex: 0 0 auto; border: 1px solid var(--dsw-alias-border-l1);',
      '  border-radius: 7px; background: var(--dsw-alias-bg-base); }',
      '.tm-pick:hover { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }',
      '.tm-folder-input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }',
      '.tm-note { flex: 1 1 100%; font-size: 10.5px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }',
      '.tm-input::placeholder { color: var(--dsw-alias-label-secondary); opacity: 0.75; }',
      '.tm-input:focus { border-color: var(--dsw-alias-brand-primary); }',
      '.tm-foot-hint { margin-left: auto; font-size: 11px; color: var(--dsw-alias-label-secondary); }',
      '.tm-link { border: 0; background: transparent; color: var(--dsw-alias-label-secondary);',
      '  font: inherit; font-size: 11px; padding: 4px 6px; border-radius: 5px; cursor: pointer; white-space: nowrap; }',
      '.tm-link:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }',
      '.tm-primary { height: 30px; padding: 0 12px; border-radius: 7px; border: 1px solid var(--dsw-alias-brand-primary);',
      '  background: transparent; color: var(--dsw-alias-brand-primary); font: inherit; font-size: 12px;',
      '  font-weight: 600; cursor: pointer; }',
      '.tm-primary:hover { background: var(--dsw-alias-bg-layer-2); }',
      '.tm-ghost { position: fixed; z-index: 2147483000; pointer-events: none; display: flex; align-items: center;',
      '  padding: 8px 10px; border-radius: 8px; background: var(--dsw-alias-bg-overlay);',
      '  border: 1px solid var(--dsw-alias-brand-primary); box-shadow: 0 14px 32px rgba(0, 0, 0, 0.34);',
      '  transform: rotate(1.2deg); opacity: 0.96; font-size: 12px; color: var(--dsw-alias-label-primary); }',
      '.tm-ghost-title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }',
      '.tm-migrate { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center;',
      '  gap: 10px; padding: 24px; text-align: center; }',
      '.tm-migrate-title { font-size: 13px; font-weight: 600; }',
      '.tm-migrate-text { font-size: 12px; color: var(--dsw-alias-label-secondary); max-width: 260px; }',
      '@media (max-width: 1100px) { .tm-add-project { flex-wrap: wrap; } .tm-input--name { flex: 1 1 140px; } }',
      '@media (max-width: 980px) { .tm-page-body { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: minmax(0, 1fr); } }',
      '@media (max-width: 900px) { .tm-foot-hint { display: none; } }',
      '@media (prefers-reduced-motion: reduce) { .tm-pulse::after { animation: none; opacity: 0; } }',
    ].join('\n')

    // ------------------------------------------------------------------
    // Plugin entry
    // ------------------------------------------------------------------

    function readLocaleService(ctx) {
      try {
        if (ctx === undefined || ctx === null || typeof ctx.get !== 'function') return undefined
        const value = ctx.get('locale')
        return value === null ? undefined : value
      } catch (error) {
        return undefined
      }
    }

    /** Keep the retired right-sidebar tab informative instead of dead. */
    function registerMigrationTab(ctx) {
      let tabs
      try { tabs = ctx.get('sidebarRightTabs') } catch (error) { tabs = undefined }
      if (tabs === null || tabs === undefined || typeof tabs.register !== 'function') return function () {}
      let offType
      try {
        offType = tabs.register({
          id: PANEL_ID,
          kind: PANEL_ID,
          keepMounted: false,
          title: function () { return panelTitle() },
        })
      } catch (error) {
        return function () {}
      }
      let offBody = function () {}
      try {
        offBody = ctx.slots.inject('sidebar.right.pane.tab', function () {
          return ctx.slots.register({
            name: 'sidebar.right.pane.tab',
            key: PANEL_ID,
            inject: function () { return { locale: moduleLocale } },
          }, MigrationBody)
        })
      } catch (error) {
        try { offType() } catch (ignored) { /* ignore */ }
        return function () {}
      }
      return function () {
        try { offBody() } catch (error) { /* ignore */ }
        try { offType() } catch (error) { /* ignore */ }
      }
    }

    return {
      inject: ['slots', 'sessions'],
      apply(ctx) {
        moduleLocale = readLocaleService(ctx)
        moduleCtx = ctx

        ctx.effect(function () {
          let dispose = function () {}
          if (moduleLocale !== undefined && typeof moduleLocale.register === 'function') {
            try {
              const offZh = moduleLocale.register(NS, 'zh', zh)
              const offEn = moduleLocale.register(NS, 'en', en)
              dispose = function () {
                try { if (typeof offZh === 'function') offZh() } catch (error) { /* ignore */ }
                try { if (typeof offEn === 'function') offEn() } catch (error) { /* ignore */ }
              }
            } catch (error) {
              // The panel's own dictionaries still resolve from the browser language.
            }
          }
          return dispose
        }, 'task-monitor: dictionaries')

        // Audio can only start after a user gesture; create/resume the context
        // on the first pointer or key interaction so a later completion chime
        // is not blocked by the browser's autoplay policy.
        ctx.effect(function () {
          if (typeof window === 'undefined') return function () {}
          const unlock = function () { ensureAudioContext() }
          window.addEventListener('pointerdown', unlock, true)
          window.addEventListener('keydown', unlock, true)
          return function () {
            try { window.removeEventListener('pointerdown', unlock, true) } catch (error) { /* ignore */ }
            try { window.removeEventListener('keydown', unlock, true) } catch (error) { /* ignore */ }
          }
        }, 'task-monitor: audio unlock')

        // Left sidebar entry: the sidebar owns the button and selects the
        // matching `main` panel by this id.
        ctx.slots.inject('sidebar.panellist', function () {
          return ctx.slots.register({
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 30,
            label: panelTitle,
          }, PanelIcon)
        })

        // The board page.
        ctx.slots.inject('main', function () {
          return ctx.slots.register({
            name: 'main',
            key: PANEL_ID,
            inject: function () { return { locale: moduleLocale } },
          }, TaskBoardPage)
        })

        // The always-mounted controller: collects sessions even while the
        // panel is closed, so the board is current when the reader opens it.
        ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register({
            name: 'shell.overlay',
            id: 'task-monitor-controller',
            order: 45,
          }, MonitorController)
        })

        ctx.effect(function () {
          return registerMigrationTab(ctx)
        }, 'task-monitor: retired right-sidebar tab')
      },
    }
  },
})
