/**
 * Client half of the Task Monitor bundle.
 *
 * A frame-wide floating board (`shell.overlay`) that keeps four lanes of work:
 * Queued, Running, Finished and Incomplete. The reader drags a card onto another
 * lane (or inside its own lane) with the pointer, drags the title bar to move
 * the window, and drags an edge/corner to resize it. Board contents and window
 * geometry survive a reload through localStorage.
 *
 * The module is a dynamic Client module: `window.__ModuleLoader__.load` returns
 * `{ inject, apply }`, React comes from the browser module table, and every
 * style is scoped under the `tm-` prefix and built from `--dsw-alias-*` theme
 * tokens so it follows light/dark switching like the host UI.
 */
window.__ModuleLoader__.load({
  id: '@local/task-monitor',
  factory(require) {
    'use strict'

    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    /** Locale namespace of the plugin's own runtime copy. */
    const NS = 'taskMonitor'
    /** localStorage key holding the board and the window geometry. */
    const STORAGE_KEY = 'dsh.task-monitor.board.v1'
    const LANE_IDS = ['queued', 'running', 'done', 'incomplete']
    const LANE_META = {
      queued: { key: 'laneQueued', tone: 'var(--dsw-alias-state-idle-primary)' },
      running: { key: 'laneRunning', tone: 'var(--dsw-alias-brand-primary)' },
      done: { key: 'laneDone', tone: 'var(--dsw-alias-state-success-primary)' },
      incomplete: { key: 'laneIncomplete', tone: 'var(--dsw-alias-state-warn-primary)' },
    }
    const MIN_WIDTH = 600
    const MIN_HEIGHT = 300
    const EDGE = 10
    const MAX_TASKS = 400

    const en = {
      title: 'Task Monitor',
      subtitle: '{total} tasks · {running} running',
      subtitleIdle: '{total} tasks · nothing running',
      laneQueued: 'Queued',
      laneRunning: 'Running',
      laneDone: 'Finished',
      laneIncomplete: 'Incomplete',
      addPlaceholder: 'Add a task, then press Enter',
      add: 'Add',
      clearFinished: 'Clear finished',
      empty: 'No tasks',
      remove: 'Delete task',
      rename: 'Rename task',
      collapse: 'Collapse',
      expand: 'Expand',
      close: 'Close',
      reopen: 'Task monitor',
      runningMeta: 'Running {time}',
      createdMeta: 'Created {time}',
      finishedMeta: 'Finished {time}',
      stoppedMeta: 'Stopped {time}',
      tookMeta: '· took {time}',
      hint: 'Drag cards between lanes; double-click a title to rename',
      sessionTag: 'Session',
      syncOn: 'Auto-sync on',
      syncOff: 'Auto-sync unavailable',
      syncHint: 'Running sidebar sessions appear in Running; when a session stops, its card moves to Finished',
      dockDescription: 'Running / finished task board in the side panel',
    }

    const zh = {
      title: '任务监控',
      subtitle: '共 {total} 项 · {running} 项运行中',
      subtitleIdle: '共 {total} 项 · 暂无运行中',
      laneQueued: '待运行',
      laneRunning: '运行中',
      laneDone: '已结束',
      laneIncomplete: '未完成',
      addPlaceholder: '输入任务，回车添加到所选状态',
      add: '添加',
      clearFinished: '清理已结束',
      empty: '暂无任务',
      remove: '删除任务',
      rename: '重命名任务',
      collapse: '收起',
      expand: '展开',
      close: '关闭',
      reopen: '任务监控',
      runningMeta: '运行中 {time}',
      createdMeta: '创建于 {time}',
      finishedMeta: '完成于 {time}',
      stoppedMeta: '停止于 {time}',
      tookMeta: '· 用时 {time}',
      hint: '拖动卡片切换状态；双击标题可重命名',
      sessionTag: '会话',
      syncOn: '自动同步',
      syncOff: '自动同步不可用',
      syncHint: '侧边栏中正在运行的会话会自动出现在「运行中」，会话停止后自动移到「已结束」',
      dockDescription: '侧边栏里的运行中 / 已结束任务看板',
    }

    const DICTS = { en: en, zh: zh }
    /** The Client locale service, attached by `apply` (undefined off-host). */
    let moduleLocale
    /** The plugin's Client context, kept for optional service access. */
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

    function uid() {
      try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
      } catch (error) {
        // A sandboxed origin may not expose crypto.randomUUID; the fallback below is enough.
      }
      return 'task-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
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

    // ------------------------------------------------------------------
    // Persistence and geometry
    // ------------------------------------------------------------------

    function isTask(value) {
      if (value === null || typeof value !== 'object') return false
      if (typeof value.id !== 'string' || typeof value.title !== 'string') return false
      return LANE_IDS.indexOf(value.status) !== -1 && typeof value.createdAt === 'number'
    }

    function isGeom(value) {
      if (value === null || typeof value !== 'object') return false
      return ['left', 'top', 'width', 'height'].every(function (key) {
        return typeof value[key] === 'number' && Number.isFinite(value[key])
      })
    }

    function clampNumber(value, min, max) {
      return Math.min(Math.max(min, value), Math.max(min, max))
    }

    function clampOrigin(start, size, viewport) {
      const inside = viewport - size - EDGE
      return inside >= EDGE
        ? clampNumber(start, EDGE, inside)
        : clampNumber(start, viewport - size - EDGE, viewport - EDGE)
    }

    function viewportSize() {
      const width = typeof window !== 'undefined' ? window.innerWidth : 1280
      const height = typeof window !== 'undefined' ? window.innerHeight : 800
      return { width: width, height: height }
    }

    function clampGeom(value) {
      const viewport = viewportSize()
      const width = clampNumber(value.width, MIN_WIDTH, Math.max(MIN_WIDTH, viewport.width - EDGE * 2))
      const height = clampNumber(value.height, MIN_HEIGHT, Math.max(MIN_HEIGHT, viewport.height - EDGE * 2))
      return {
        left: clampOrigin(value.left, width, viewport.width),
        top: clampOrigin(value.top, height, viewport.height),
        width: width,
        height: height,
      }
    }

    function defaultGeom() {
      const viewport = viewportSize()
      const width = Math.min(840, Math.max(MIN_WIDTH, viewport.width - 160))
      const height = Math.min(500, Math.max(MIN_HEIGHT, viewport.height - 240))
      return clampGeom({
        left: viewport.width - width - 28,
        top: 92,
        width: width,
        height: height,
      })
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
              }
            })
          : []
        return {
          tasks: tasks,
          geom: isGeom(data.geom) ? data.geom : null,
          collapsed: data.collapsed === true,
          hidden: data.hidden === true,
          ignored: Array.isArray(data.ignored)
            ? data.ignored.filter(function (id) { return typeof id === 'string' }).slice(0, 200)
            : [],
        }
      } catch (error) {
        return null
      }
    }

    function writeStored(state) {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      } catch (error) {
        // Storage may be unavailable or full; the board still works in memory.
      }
    }

    /**
     * Reconcile the auto-tracked session cards with the live sidebar rows.
     *
     * A session that starts running gains a card in the Running lane; when it
     * stops, that card moves to Finished with its measured duration. Only cards
     * this module created (`source: 'session'`, `auto !== false`) are touched:
     * a card the reader dragged to another lane is handed over to manual
     * control, and a card the reader deleted stays suppressed until the session
     * next starts a run (see the `ignored` list).
     *
     * @param tasks - current board.
     * @param rows - `{ id, title, running }` rows for the sidebar sessions.
     * @param ignored - session ids whose card the reader deleted while running.
     * @returns the same array when nothing changed, a new array otherwise.
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
        const stamp = Date.now()
        if (row.running) {
          if (index === -1) {
            if (ignored.indexOf(row.id) !== -1) return
            next.push({
              id: uid(),
              title: row.title,
              status: 'running',
              createdAt: stamp,
              startedAt: stamp,
              source: 'session',
              sessionId: row.id,
              auto: true,
            })
            changed = true
            return
          }
          const card = next[index]
          let updated = card
          if (card.status !== 'running') {
            updated = { ...updated, status: 'running', startedAt: stamp, finishedAt: undefined, durationMs: undefined }
          }
          if (updated.title !== row.title) updated = { ...updated, title: row.title }
          if (updated !== card) {
            next[index] = updated
            changed = true
          }
          return
        }
        if (index === -1) return
        // The stop transition is NOT decided here: only the retained session's
        // `turn/end` reason can distinguish a normal finish from an error or an
        // interruption (see the finish effect). This fold only keeps the label
        // current while the outcome is being resolved.
        const card = next[index]
        if (card.title !== row.title) {
          next[index] = { ...card, title: row.title }
          changed = true
        }
      })
      return changed ? next : tasks
    }

    // ------------------------------------------------------------------
    // Icons
    // ------------------------------------------------------------------

    function iconSvg(paths) {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: 14,
        height: 14,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        focusable: false,
      }, paths)
    }

    function IconCollapse() {
      return iconSvg(h('path', { d: 'M3.5 8h9' }))
    }

    function IconExpand() {
      return iconSvg(h('path', { d: 'M3.5 10.5 8 6l4.5 4.5' }))
    }

    function IconClose() {
      return iconSvg(h('path', { d: 'M4.5 4.5l7 7M11.5 4.5l-7 7' }))
    }

    function IconChevronDown() {
      return iconSvg(h('path', { d: 'M4 6.5 8 10.5l4-4' }))
    }

    // ------------------------------------------------------------------
    // Session outcome tracking (completed vs error/interrupted)
    // ------------------------------------------------------------------
    //
    // The sidebar status store only carries `running` / `completionUnread` /
    // `pendingInteraction`, so it cannot tell a normal finish from an error or
    // a user stop. The durable Session event log can: the last `turn/end`
    // reason is `completed` for a normal finish, and `error`, `aborted`
    // (user stop), `interrupted`, `max-tokens`, `blocked`, … otherwise. The
    // plugin retains only the sessions it is actually tracking (a handful at
    // most) and releases each one right after its terminal lane is decided.

    /** The optional Client sessions service (`ctx.sessions` face). */
    function getSessionsService() {
      try {
        if (moduleCtx === undefined || moduleCtx === null || typeof moduleCtx.get !== 'function') return undefined
        const service = moduleCtx.get('sessions')
        return service === null ? undefined : service
      } catch (error) {
        return undefined
      }
    }

    /** The latest `turn/end` reason kind in one retained event window. */
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

    /** Retain one session and record its latest turn outcome; null when unavailable. */
    function createSessionTracker(sessionId, trackers) {
      if (trackers.has(sessionId)) return trackers.get(sessionId)
      // A monitor never needs an unbounded number of retained histories.
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
          // Best effort: without the window the outcome falls back to unknown.
        }
      }).catch(function () {
        tracker.ready = true
      })
      return tracker
    }

    /** Unsubscribe and release one retained session. */
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

    // ------------------------------------------------------------------
    // Component
    // ------------------------------------------------------------------

    function TaskMonitorPanel(props) {
      const locale = props !== null && props !== undefined && props.locale ? props.locale : moduleLocale
      const docked = props !== null && props !== undefined && props.mode === 'dock'
      const [active, setActive] = useState(function () { return activeLocaleOf(locale) })

      useEffect(function () {
        setActive(activeLocaleOf(locale))
        if (locale === undefined || locale === null || typeof locale.subscribe !== 'function') return undefined
        function onLocaleChange() {
          setActive(activeLocaleOf(locale))
        }
        try {
          return locale.subscribe(onLocaleChange)
        } catch (error) {
          return undefined
        }
      }, [locale])

      const dict = dictFor(active)
      const tr = useCallback(function (key, params) {
        return translate(dict, key, params)
      }, [dict])

      const [boot] = useState(readStored)
      const [tasks, setTasks] = useState(function () {
        return boot !== null && boot.tasks !== null ? boot.tasks : []
      })
      const [geom, setGeom] = useState(function () {
        return boot !== null && boot.geom !== null ? clampGeom(boot.geom) : defaultGeom()
      })
      const [collapsed, setCollapsed] = useState(function () {
        return boot !== null && boot.collapsed === true
      })
      const [hidden, setHidden] = useState(function () {
        return boot !== null && boot.hidden === true
      })
      const [ignored, setIgnored] = useState(function () {
        return boot !== null && Array.isArray(boot.ignored) ? boot.ignored : []
      })
      const [draft, setDraft] = useState('')
      const [targetLane, setTargetLane] = useState('queued')
      const [editing, setEditing] = useState(null)
      const [drag, setDrag] = useState(null)
      const [drop, setDrop] = useState(null)
      const [now, setNow] = useState(function () { return Date.now() })

      const geomRef = useRef(geom)
      geomRef.current = geom
      const tasksRef = useRef(tasks)
      tasksRef.current = tasks
      const editingRef = useRef(editing)
      editingRef.current = editing
      const ignoredRef = useRef(ignored)
      ignoredRef.current = ignored
      const dragRef = useRef(drag)
      dragRef.current = drag
      const cancelledRef = useRef(false)
      const laneRefs = useRef({})
      const trackersRef = useRef(new Map())
      const previousRunningRef = useRef(null)

      // Persist the board and the window geometry on every committed change.
      useEffect(function () {
        writeStored({ tasks: tasks, geom: geom, collapsed: collapsed, hidden: hidden, ignored: ignored })
      }, [tasks, geom, collapsed, hidden, ignored])

      // ----------------------------------------------------------------
      // Live sync with the sidebar's sessions
      // ----------------------------------------------------------------
      //
      // Every slot entry receives the standard session hooks: `useSessions`
      // selects from the session list (ids + byId), and `useSessionStatus`
      // selects from the per-session status Map (`running`, pendingInteraction,
      // completionUnread). They are optional so the panel still works where a
      // slot omits them; the object identities only change when the snapshot
      // changes, which keeps the reconciliation cheap.
      const autoSync = typeof props !== 'undefined' && props !== null
        && typeof props.useSessions === 'function'
        && typeof props.useSessionStatus === 'function'
      const sessionsState = autoSync
        ? props.useSessions(function (state) { return state })
        : undefined
      const statusState = autoSync
        ? props.useSessionStatus(function (state) { return state })
        : undefined
      const sessionRows = useMemo(function () {
        if (!autoSync) return []
        const byId = (sessionsState !== null && sessionsState !== undefined && sessionsState.byId) || {}
        const listed = sessionsState !== null && sessionsState !== undefined && Array.isArray(sessionsState.ids)
          ? sessionsState.ids
          : []
        const ids = listed.length > 0 ? listed : Object.keys(byId)
        const rows = []
        ids.forEach(function (id) {
          if (typeof id !== 'string' || id === '') return
          const view = byId[id] || {}
          const status = statusState !== null && statusState !== undefined && typeof statusState.get === 'function'
            ? statusState.get(id)
            : undefined
          const running = !!(view.running || (status !== null && status !== undefined && status.running))
          rows.push({
            id: id,
            title: String(view.displayTitle || view.title || view.name || id),
            running: running,
          })
        })
        return rows
      }, [autoSync, sessionsState, statusState])
      const sessionSignature = useMemo(function () {
        return sessionRows.map(function (row) {
          return row.id + (row.running ? '+' : '-') + ':' + row.title
        }).join('|')
      }, [sessionRows])
      const rowsRef = useRef(sessionRows)
      rowsRef.current = sessionRows

      useEffect(function () {
        const rows = rowsRef.current
        if (rows.length === 0) return
        setTasks(function (previous) { return syncSessionCards(previous, rows, ignoredRef.current) })
        const runningIds = {}
        rows.forEach(function (row) { if (row.running) runningIds[row.id] = true })
        setIgnored(function (previous) {
          const next = previous.filter(function (id) { return runningIds[id] === true })
          return next.length === previous.length ? previous : next
        })
      }, [sessionSignature])

      // Classify every run that just stopped. A run is retained while it is
      // live, so the terminal lane can be read from its `turn/end` reason:
      // `completed` finishes the card, anything else (error, user stop,
      // interruption, token/blocked end) moves it to Incomplete.
      useEffect(function () {
        const rows = rowsRef.current
        if (rows.length === 0) return
        const running = {}
        rows.forEach(function (row) { if (row.running) running[row.id] = true })
        Object.keys(running).forEach(function (id) { ensureTracker(id) })
        const previous = previousRunningRef.current
        if (previous === null) {
          tasksRef.current.filter(function (task) {
            return task.status === 'running' && task.source === 'session' && task.auto !== false
          }).forEach(function (task) {
            if (running[task.sessionId] !== true) finishTracked(task.sessionId)
          })
        } else {
          Object.keys(previous).forEach(function (id) {
            if (running[id] !== true) finishTracked(id)
          })
        }
        previousRunningRef.current = running
      }, [sessionSignature])

      // Release every retained session when the pane unmounts.
      useEffect(function () {
        return function () {
          const trackers = trackersRef.current
          Array.from(trackers.keys()).forEach(function (id) { releaseSessionTracker(id, trackers) })
        }
      }, [])

      /** Retain (or reuse) the tracker of one running session. */
      function ensureTracker(id) {
        return createSessionTracker(id, trackersRef.current)
      }

      /** Move one auto card to its terminal lane with measured duration. */
      function finishCard(id, lane) {
        setTasks(function (previous) {
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
        setNow(Date.now())
      }

      /** Resolve the terminal lane of one stopped session and release it. */
      function finishTracked(id) {
        const stillRunning = rowsRef.current.some(function (row) { return row.id === id && row.running })
        if (stillRunning) return
        let tracker = trackersRef.current.get(id)
        if (tracker === undefined) tracker = ensureTracker(id)
        if (tracker === null || tracker === undefined) {
          finishCard(id, 'done')
          return
        }
        let settled = false
        const settle = function () {
          if (settled || tracker.disposed) return
          settled = true
          const nowRunning = rowsRef.current.some(function (row) { return row.id === id && row.running })
          if (nowRunning) {
            releaseSessionTracker(id, trackersRef.current)
            return
          }
          const reason = tracker.reason
          const error = tracker.error
          const failed = (reason !== undefined && reason !== 'completed')
            || (reason === undefined && typeof error === 'string' && error !== '')
          finishCard(id, failed ? 'incomplete' : 'done')
          releaseSessionTracker(id, trackersRef.current)
        }
        if (tracker.ready) {
          settle()
        } else {
          // The initial history page may still be landing when the run stops;
          // give the event window one short beat so the terminal `turn/end`
          // can be read before the fallback decides "completed".
          Promise.resolve(tracker.reference.ready).then(function () {
            window.setTimeout(settle, 300)
          }).catch(function () {
            if (settled || tracker.disposed) return
            settled = true
            finishCard(id, 'done')
            releaseSessionTracker(id, trackersRef.current)
          })
        }
      }

      // Keep the window reachable when the viewport changes.
      useEffect(function () {
        function onResize() {
          setGeom(function (current) { return clampGeom(current) })
        }
        window.addEventListener('resize', onResize)
        return function () { window.removeEventListener('resize', onResize) }
      }, [])

      // Tick only while something is running (the running cards show a live clock).
      useEffect(function () {
        const anyRunning = tasks.some(function (task) { return task.status === 'running' })
        if (!anyRunning) return undefined
        const handle = window.setInterval(function () { setNow(Date.now()) }, 1000)
        return function () { window.clearInterval(handle) }
      }, [tasks])

      // Escape cancels a card drag or cancels an inline rename.
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
      // Pointer gestures
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
        return node.closest('button, input, select, textarea, a, [data-tm-no-drag]') !== null
      }

      function onHeaderPointerDown(event) {
        if (event.button !== 0) return
        if (isInteractive(event.target)) return
        const start = geomRef.current
        const startX = event.clientX
        const startY = event.clientY
        beginPointerDrag(event, function (pointerEvent) {
          setGeom(function () {
            return clampGeom({
              left: start.left + (pointerEvent.clientX - startX),
              top: start.top + (pointerEvent.clientY - startY),
              width: start.width,
              height: start.height,
            })
          })
        }, function () {})
      }

      function startResize(axis) {
        return function (event) {
          if (event.button !== 0) return
          event.stopPropagation()
          const start = geomRef.current
          const startX = event.clientX
          const startY = event.clientY
          beginPointerDrag(event, function (pointerEvent) {
            setGeom(function () {
              const next = { left: start.left, top: start.top, width: start.width, height: start.height }
              if (axis !== 'y') next.width = Math.max(MIN_WIDTH, start.width + (pointerEvent.clientX - startX))
              if (axis !== 'x') next.height = Math.max(MIN_HEIGHT, start.height + (pointerEvent.clientY - startY))
              return clampGeom(next)
            })
          }, function () {})
        }
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
      // Board mutations
      // ----------------------------------------------------------------

      function addTask(title, lane) {
        const text = String(title || '').trim().slice(0, 200)
        if (text === '') return
        const stamp = Date.now()
        const task = { id: uid(), title: text, status: lane, createdAt: stamp }
        if (lane === 'running') task.startedAt = stamp
        if (lane === 'done' || lane === 'incomplete') task.finishedAt = stamp
        setTasks(function (previous) {
          const next = previous.concat([task])
          return next.length > MAX_TASKS ? next.slice(next.length - MAX_TASKS) : next
        })
        setNow(stamp)
      }

      function removeTask(id) {
        const task = tasksRef.current.filter(function (item) { return item.id === id })[0]
        if (task !== undefined && task.sessionId) {
          setIgnored(function (previous) {
            return previous.indexOf(task.sessionId) === -1 ? previous.concat([task.sessionId]) : previous
          })
        }
        setTasks(function (previous) {
          return previous.filter(function (item) { return item.id !== id })
        })
      }

      function clearDone() {
        setTasks(function (previous) {
          return previous.filter(function (task) { return task.status !== 'done' })
        })
      }

      function moveTask(id, lane, indexInLane, keepAuto) {
        setTasks(function (previous) {
          const task = previous.filter(function (item) { return item.id === id })[0]
          if (task === undefined) return previous
          const rest = previous.filter(function (item) { return item.id !== id })
          const stamp = Date.now()
          const next = { ...task, status: lane }
          // A reader's lane change takes the card over from the live sync;
          // reordering inside its own lane keeps it auto-tracked.
          if (next.sessionId && keepAuto !== true && lane !== task.status) next.auto = false
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
        setNow(Date.now())
      }

      function commitEdit(id) {
        const current = editingRef.current
        if (current === null || current.id !== id) return
        editingRef.current = null
        setEditing(null)
        const title = String(current.value || '').trim().slice(0, 200)
        if (title === '') return
        setTasks(function (previous) {
          return previous.map(function (task) {
            return task.id === id ? { ...task, title: title } : task
          })
        })
      }

      function submitDraft() {
        const title = draft.trim()
        if (title === '') return
        addTask(title, targetLane)
        setDraft('')
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

      function renderCard(task) {
        const dragging = drag !== null && drag.id === task.id
        const tone = LANE_META[task.status] !== undefined ? LANE_META[task.status].tone : 'var(--dsw-alias-label-secondary)'
        const isEditing = editing !== null && editing.id === task.id
        return h('div', {
          key: task.id,
          className: 'tm-card' + (dragging ? ' tm-card--dragging' : ''),
          'data-tm-task-id': task.id,
          style: { '--tm-tone': tone },
          onPointerDown: function (event) { onCardPointerDown(task, event) },
        }, [
          h('div', { key: 'top', className: 'tm-card-top' }, [
            isEditing
              ? h('input', {
                  key: 'edit',
                  className: 'tm-edit',
                  type: 'text',
                  value: editing.value,
                  autoFocus: true,
                  maxLength: 200,
                  'aria-label': tr('rename'),
                  onChange: function (event) {
                    setEditing({ id: task.id, value: event.target.value })
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
                  onDoubleClick: function () { setEditing({ id: task.id, value: task.title }) },
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
          h('div', {
            key: 'meta',
            className: 'tm-card-meta' + (task.status === 'running' ? ' tm-card-meta--running' : ''),
          }, [
            task.sessionId
              ? h('span', { key: 'tag', className: 'tm-tag', title: tr('syncHint') }, tr('sessionTag'))
              : null,
            h('span', { key: 'text', className: 'tm-meta-text' }, cardMeta(task)),
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

      function renderFooter() {
        return h('div', { key: 'footer', className: 'tm-footer' }, [
          h('form', {
            key: 'form',
            className: 'tm-add',
            onSubmit: function (event) { event.preventDefault(); submitDraft() },
          }, [
            h('input', {
              key: 'input',
              className: 'tm-input',
              type: 'text',
              value: draft,
              maxLength: 200,
              placeholder: tr('addPlaceholder'),
              'aria-label': tr('addPlaceholder'),
              onChange: function (event) { setDraft(event.target.value) },
            }),
            h('select', {
              key: 'select',
              className: 'tm-select',
              value: targetLane,
              'aria-label': tr('add'),
              onChange: function (event) { setTargetLane(event.target.value) },
            }, LANE_IDS.map(function (lane) {
              return h('option', { key: lane, value: lane }, tr(LANE_META[lane].key))
            })),
            h('button', {
              key: 'submit',
              className: 'tm-primary',
              type: 'submit',
              disabled: draft.trim() === '',
            }, tr('add')),
          ]),
          doneCount > 0
            ? h('button', {
                key: 'clear',
                type: 'button',
                className: 'tm-link',
                onClick: clearDone,
              }, tr('clearFinished'))
            : null,
          h('span', {
            key: 'sync',
            className: 'tm-sync' + (autoSync ? ' tm-sync--on' : ' tm-sync--off'),
            title: autoSync ? tr('syncHint') : tr('syncOff'),
            'aria-label': autoSync ? tr('syncOn') : tr('syncOff'),
          }, h('span', { key: 'dot', className: 'tm-sync-dot', 'aria-hidden': true })),
        ])
      }

      // The right-sidebar tab body: no window chrome, no geometry, no
      // collapse/close — the native pane owns all of that. The lanes reflow to
      // two columns (or one) so the same board works in a narrow sidebar.
      if (docked) {
        return h(React.Fragment, null,
          h('style', { key: 'style', dangerouslySetInnerHTML: { __html: CSS } }),
          h('div', { key: 'dock', className: 'tm-root tm-dock', 'data-tm-dock': '' }, [
            h('div', { key: 'head', className: 'tm-dock-head' }, [
              h('span', { key: 'pulse', className: 'tm-pulse', 'aria-hidden': true }),
              h('div', { key: 'titles', className: 'tm-titles' }, [
                h('div', { key: 'title', className: 'tm-title' }, tr('title')),
                h('div', { key: 'sub', className: 'tm-subtitle', title: tr('hint') }, subtitleText),
              ]),
            ]),
            h('div', { key: 'body', className: 'tm-body tm-dock-body' }, LANE_IDS.map(renderLane)),
            renderFooter(),
          ]),
        )
      }

      if (hidden) {
        return h(React.Fragment, null,
          h('style', { key: 'style', dangerouslySetInnerHTML: { __html: CSS } }),
          h('button', {
            key: 'pill',
            type: 'button',
            className: 'tm-root tm-pill',
            style: { left: geom.left, top: geom.top },
            title: tr('reopen'),
            'aria-label': tr('reopen'),
            onClick: function () { setHidden(false) },
          }, [
            h('span', { key: 'dot', className: 'tm-pill-dot', 'aria-hidden': true }),
            h('span', { key: 'text', className: 'tm-pill-text' }, tr('reopen')),
            h('span', { key: 'count', className: 'tm-pill-count' }, String(tasks.length)),
          ]),
        )
      }

      const header = h('div', {
        key: 'header',
        className: 'tm-header',
        onPointerDown: onHeaderPointerDown,
      }, [
        h('span', { key: 'pulse', className: 'tm-pulse', 'aria-hidden': true }),
        h('div', { key: 'titles', className: 'tm-titles' }, [
          h('div', { key: 'title', className: 'tm-title' }, tr('title')),
          h('div', { key: 'sub', className: 'tm-subtitle', title: tr('hint') }, subtitleText),
        ]),
        h('div', { key: 'actions', className: 'tm-actions', 'data-tm-no-drag': '' }, [
          h('button', {
            key: 'collapse',
            type: 'button',
            className: 'tm-icon',
            'aria-label': collapsed ? tr('expand') : tr('collapse'),
            title: collapsed ? tr('expand') : tr('collapse'),
            onClick: function () { setCollapsed(function (value) { return !value }) },
          }, collapsed ? h(IconExpand) : h(IconCollapse)),
          h('button', {
            key: 'close',
            type: 'button',
            className: 'tm-icon',
            'aria-label': tr('close'),
            title: tr('close'),
            onClick: function () { setHidden(true) },
          }, h(IconClose)),
        ]),
      ])

      const handles = collapsed ? null : [
        h('div', { key: 'r', className: 'tm-resize tm-resize--r', 'aria-hidden': true, onPointerDown: startResize('x') }),
        h('div', { key: 'b', className: 'tm-resize tm-resize--b', 'aria-hidden': true, onPointerDown: startResize('y') }),
        h('div', { key: 'c', className: 'tm-resize tm-resize--c', 'aria-hidden': true, onPointerDown: startResize('both') }),
      ]

      const ghost = drag === null ? null : h('div', {
        key: 'ghost',
        className: 'tm-ghost',
        'aria-hidden': true,
        style: {
          left: Math.min(drag.x + 14, viewportSize().width - 260),
          top: drag.y - 20,
          width: Math.min(Math.max(170, drag.width - 6), 260),
        },
      }, h('span', { key: 'title', className: 'tm-ghost-title' }, drag.title))

      const panelStyle = collapsed
        ? { left: geom.left, top: geom.top, width: Math.min(geom.width, 430), height: 46 }
        : { left: geom.left, top: geom.top, width: geom.width, height: geom.height }

      return h(React.Fragment, null,
        h('style', { key: 'style', dangerouslySetInnerHTML: { __html: CSS } }),
        h('div', {
          key: 'panel',
          className: 'tm-root tm-panel' + (collapsed ? ' tm-panel--collapsed' : ''),
          style: panelStyle,
          role: 'dialog',
          'aria-label': tr('title'),
          'data-tm-panel': '',
        }, collapsed
          ? [header]
          : [header, h('div', { key: 'body', className: 'tm-body' }, LANE_IDS.map(renderLane)), renderFooter(), handles]),
        ghost,
      )
    }

    // ------------------------------------------------------------------
    // Styles (scoped; theme tokens only)
    // ------------------------------------------------------------------

    const CSS = [
      '.tm-root, .tm-root * { box-sizing: border-box; }',
      '.tm-root { font-family: inherit; color: var(--dsw-alias-label-primary); }',
      '.tm-panel { position: fixed; display: flex; flex-direction: column; min-width: 0; min-height: 0;',
      '  pointer-events: auto; overflow: hidden; font-size: 12.5px; line-height: 1.42;',
      '  background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1);',
      '  border-radius: 12px; box-shadow: 0 18px 52px rgba(0, 0, 0, 0.32), 0 1px 0 rgba(255, 255, 255, 0.04) inset; }',
      '.tm-header { flex: 0 0 44px; height: 44px; display: flex; align-items: center; gap: 10px;',
      '  padding: 0 8px 0 14px; cursor: grab; user-select: none; touch-action: none;',
      '  border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }',
      '.tm-panel--collapsed .tm-header { border-bottom: 0; }',
      '.tm-header:active { cursor: grabbing; }',
      '.tm-pulse { position: relative; width: 8px; height: 8px; border-radius: 999px; flex: 0 0 auto;',
      '  background: var(--dsw-alias-brand-primary); }',
      '.tm-pulse::after { content: ""; position: absolute; inset: -4px; border-radius: 999px;',
      '  border: 1px solid var(--dsw-alias-brand-primary); opacity: 0.6; animation: tm-ping 2.6s ease-out infinite; }',
      '@keyframes tm-ping { 0% { transform: scale(0.55); opacity: 0.55; } 70%, 100% { transform: scale(1.35); opacity: 0; } }',
      '.tm-titles { min-width: 0; display: flex; flex-direction: column; gap: 1px; }',
      '.tm-title { font-size: 12.5px; font-weight: 600; letter-spacing: 0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '.tm-subtitle { font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '.tm-actions { margin-left: auto; display: flex; align-items: center; gap: 2px; }',
      '.tm-icon { display: grid; place-items: center; width: 26px; height: 26px; padding: 0; border: 0;',
      '  border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }',
      '.tm-icon:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }',
      '.tm-icon:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }',
      '.tm-body { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; padding: 10px; }',
      '.tm-lane { display: flex; flex-direction: column; min-width: 0; min-height: 0; gap: 6px; padding: 6px;',
      '  background: var(--dsw-alias-bg-base); border: 1px solid transparent; border-radius: 9px; transition: border-color 120ms ease; }',
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
      '  background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px;',
      '  cursor: grab; user-select: none; touch-action: none; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);',
      '  transition: border-color 120ms ease, opacity 120ms ease; }',
      '.tm-card::before { content: ""; position: absolute; left: 0; top: 7px; bottom: 7px; width: 2.5px;',
      '  border-radius: 2px; background: var(--tm-tone); opacity: 0.9; }',
      '.tm-card:hover { border-color: var(--dsw-alias-border-l2); }',
      '.tm-card:active { cursor: grabbing; }',
      '.tm-card--dragging { opacity: 0.34; }',
      '.tm-card-top { display: flex; align-items: flex-start; gap: 4px; }',
      '.tm-card-title { flex: 1 1 auto; min-width: 0; font-size: 12px; padding-left: 2px; word-break: break-word; white-space: pre-wrap; }',
      '.tm-card-meta { padding-left: 2px; display: flex; align-items: center; gap: 5px; flex-wrap: wrap;',
      '  font-size: 10.5px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }',
      '.tm-meta-text { min-width: 0; }',
      '.tm-tag { display: inline-flex; align-items: center; height: 14px; padding: 0 4px; border-radius: 4px;',
      '  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);',
      '  font-size: 9.5px; line-height: 1; white-space: nowrap; }',
      '.tm-card-meta--running { color: var(--dsw-alias-brand-primary); }',
      '.tm-remove { width: 20px; height: 20px; flex: 0 0 auto; opacity: 0; transition: opacity 120ms ease; }',
      '.tm-card:hover .tm-remove, .tm-card:focus-within .tm-remove { opacity: 1; }',
      '.tm-edit { flex: 1 1 auto; min-width: 0; font: inherit; font-size: 12px; color: var(--dsw-alias-label-primary);',
      '  background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-brand-primary);',
      '  border-radius: 5px; padding: 1px 5px; outline: none; }',
      '.tm-drop { flex: 0 0 auto; height: 2px; margin: 1px 2px; border-radius: 2px;',
      '  background: var(--dsw-alias-brand-primary); opacity: 0.9; box-shadow: 0 0 8px var(--dsw-alias-brand-primary); }',
      '.tm-empty { margin: auto 0; padding: 14px 0; text-align: center; font-size: 11px;',
      '  color: var(--dsw-alias-label-secondary); opacity: 0.7; }',
      '.tm-footer { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 9px 10px;',
      '  border-top: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }',
      '.tm-add { display: flex; align-items: center; gap: 6px; flex: 1 1 auto; min-width: 0; margin: 0; }',
      '.tm-input { flex: 1 1 auto; min-width: 0; height: 30px; padding: 0 9px; border-radius: 7px;',
      '  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base);',
      '  color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; outline: none; }',
      '.tm-input::placeholder { color: var(--dsw-alias-label-secondary); opacity: 0.75; }',
      '.tm-input:focus { border-color: var(--dsw-alias-brand-primary); }',
      '.tm-select { height: 30px; max-width: 98px; padding: 0 6px; border-radius: 7px;',
      '  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base);',
      '  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 11.5px; outline: none; cursor: pointer; }',
      '.tm-select:focus { border-color: var(--dsw-alias-brand-primary); }',
      '.tm-primary { height: 30px; padding: 0 12px; border-radius: 7px; border: 1px solid var(--dsw-alias-brand-primary);',
      '  background: transparent; color: var(--dsw-alias-brand-primary); font: inherit; font-size: 12px;',
      '  font-weight: 600; cursor: pointer; }',
      '.tm-primary:hover { background: var(--dsw-alias-bg-layer-2); }',
      '.tm-primary:disabled { opacity: 0.45; cursor: default; background: transparent; }',
      '.tm-link { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit;',
      '  font-size: 11px; padding: 4px 6px; border-radius: 5px; cursor: pointer; white-space: nowrap; }',
      '.tm-link:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }',
      '.tm-sync { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px;',
      '  flex: 0 0 auto; }',
      '.tm-sync-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--dsw-alias-state-success-primary); }',
      '.tm-sync--off .tm-sync-dot { background: var(--dsw-alias-label-secondary); opacity: 0.6; }',
      '.tm-resize { position: absolute; z-index: 3; }',
      '.tm-resize--r { top: 8px; right: 0; bottom: 12px; width: 6px; cursor: ew-resize; }',
      '.tm-resize--b { left: 8px; right: 14px; bottom: 0; height: 6px; cursor: ns-resize; }',
      '.tm-resize--c { right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize; }',
      '.tm-resize--c::after { content: ""; position: absolute; right: 4px; bottom: 4px; width: 7px; height: 7px;',
      '  border-right: 1.5px solid var(--dsw-alias-border-l2); border-bottom: 1.5px solid var(--dsw-alias-border-l2);',
      '  border-radius: 0 0 2px 0; }',
      '.tm-ghost { position: fixed; z-index: 2147483000; pointer-events: none; display: flex; align-items: center;',
      '  padding: 8px 10px; border-radius: 8px; background: var(--dsw-alias-bg-overlay);',
      '  border: 1px solid var(--dsw-alias-brand-primary); box-shadow: 0 14px 32px rgba(0, 0, 0, 0.34);',
      '  transform: rotate(1.2deg); opacity: 0.96; font-size: 12px; color: var(--dsw-alias-label-primary); }',
      '.tm-ghost-title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }',
      '.tm-pill { position: fixed; z-index: 2147482999; display: flex; align-items: center; gap: 8px; height: 34px;',
      '  padding: 0 12px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1);',
      '  background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px;',
      '  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.28); cursor: pointer; pointer-events: auto; max-width: 220px; }',
      '.tm-pill:hover { border-color: var(--dsw-alias-border-l2); }',
      '.tm-pill-dot { width: 8px; height: 8px; border-radius: 999px; background: var(--dsw-alias-brand-primary); flex: 0 0 auto; }',
      '.tm-pill-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '.tm-pill-count { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; display: grid;',
      '  place-items: center; font-size: 10.5px; color: var(--dsw-alias-label-secondary);',
      '  background: var(--dsw-alias-bg-layer-2); font-variant-numeric: tabular-nums; }',
      '@media (max-width: 760px) { .tm-body { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: minmax(0, 1fr); } }',
      '@media (prefers-reduced-motion: reduce) { .tm-pulse::after { animation: none; opacity: 0; } }',
      // Native right-sidebar tab body: the pane owns the chrome, so the board
      // drops the window frame and reflows its lanes to the pane width.
      '.tm-dock { position: relative; width: 100%; height: 100%; min-height: 0; display: flex; flex-direction: column;',
      '  background: transparent; pointer-events: auto; font-size: 12.5px; line-height: 1.42; }',
      '.tm-dock-head { flex: 0 0 auto; display: flex; align-items: center; gap: 9px; min-width: 0;',
      '  padding: 9px 10px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); }',
      '.tm-dock-body { flex: 1 1 auto; min-height: 0; grid-template-columns: repeat(auto-fit, minmax(148px, 1fr));',
      '  grid-auto-rows: minmax(0, 1fr); gap: 8px; padding: 8px 10px; overflow: hidden; }',
      '.tm-dock-body .tm-lane { background: var(--dsw-alias-bg-base); }',
      '.tm-dock .tm-footer { background: transparent; flex-wrap: wrap; row-gap: 6px; }',
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

    /** The native tab's title, localized at call time. */
    function dockTitle() {
      return translate(dictFor(activeLocaleOf(moduleLocale)), 'title')
    }

    /** The native guide row's description, localized at call time. */
    function dockDescription() {
      return translate(dictFor(activeLocaleOf(moduleLocale)), 'dockDescription')
    }

    /** The guide row's glyph: a small board with three status columns. */
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

    const AUTO_OPEN_KEY = 'dsh.task-monitor.dock-open.v2'

    /** Open the tab in the right sidebar once per browser. */
    function autoOpenDockTab(ctx) {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return
        if (window.localStorage.getItem(AUTO_OPEN_KEY) === '1') return
      } catch (error) {
        return
      }
      let tries = 0
      const isOpen = function (right) {
        try {
          const source = right !== null && right !== undefined ? right.openTabs : undefined
          const rows = source !== undefined && source !== null && typeof source.getSnapshot === 'function'
            ? source.getSnapshot()
            : undefined
          if (!Array.isArray(rows)) return false
          return rows.some(function (row) {
            return row !== null && row !== undefined && row.kind === 'task-monitor'
          })
        } catch (error) {
          return false
        }
      }
      const attempt = function () {
        tries += 1
        let opened = false
        try {
          const right = ctx.get('sidebarRight')
          if (right !== null && right !== undefined && typeof right.openTab === 'function') {
            if (!isOpen(right)) right.openTab('task-monitor')
            opened = isOpen(right)
          }
        } catch (error) {
          opened = false
        }
        if (opened) {
          try { window.localStorage.setItem(AUTO_OPEN_KEY, '1') } catch (error) { /* ignore */ }
          return
        }
        if (tries < 3) window.setTimeout(attempt, 900)
      }
      window.setTimeout(attempt, 900)
    }

    /**
     * Register the native right-sidebar tab: its type + guide capsule in the
     * host's `sidebarRightTabs` registry, and the body in the keyed
     * `sidebar.right.pane.tab` seat. Null when the host refuses the type (for
     * example a stale id after a reload), so the caller can fall back.
     */
    function registerDockTab(ctx, tabs) {
      const disposers = []
      const disposeAll = function () {
        for (let index = disposers.length - 1; index >= 0; index -= 1) {
          try { disposers[index]() } catch (error) { /* release best effort */ }
        }
        disposers.length = 0
      }
      try {
        disposers.push(tabs.register({
          id: 'task-monitor',
          kind: 'task-monitor',
          keepMounted: true,
          title: function () { return dockTitle() },
          guide: [{
            id: 'task-monitor',
            order: 30,
            title: function () { return dockTitle() },
            description: function () { return dockDescription() },
            icon: IconBoard,
          }],
        }))
        disposers.push(ctx.slots.inject('sidebar.right.pane.tab', function () {
          return ctx.slots.register({
            name: 'sidebar.right.pane.tab',
            key: 'task-monitor',
            inject: function () { return { locale: moduleLocale, mode: 'dock' } },
          }, TaskMonitorPanel)
        }))
      } catch (error) {
        disposeAll()
        return null
      }
      return disposeAll
    }

    /** Fallback floating window when the native right sidebar is unavailable. */
    function registerOverlay(ctx) {
      try {
        return ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register({
            name: 'shell.overlay',
            id: 'task-monitor',
            order: 40,
            label: dockTitle,
            inject: function () { return { locale: moduleLocale } },
          }, TaskMonitorPanel)
        })
      } catch (error) {
        return function () {}
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
              // An older locale service without this register shape: the panel's
              // own dictionaries still resolve from the browser language.
            }
          }
          return dispose
        }, 'task-monitor: dictionaries')

        // Prefer the native right-sidebar tab; fall back to the floating
        // window only when the host never provides its tab registry (for
        // example a deployment without the right sidebar pane).
        ctx.effect(function () {
          let stopped = false
          let timer = 0
          let attempts = 0
          let disposeDock = null
          let disposeOverlay = null
          const install = function () {
            if (stopped) return
            let tabs
            try { tabs = ctx.get('sidebarRightTabs') } catch (error) { tabs = undefined }
            if (tabs !== null && tabs !== undefined && typeof tabs.register === 'function') {
              const dispose = registerDockTab(ctx, tabs)
              if (dispose !== null) {
                disposeDock = dispose
                if (disposeOverlay !== null) {
                  const off = disposeOverlay
                  disposeOverlay = null
                  try { off() } catch (error) { /* ignore */ }
                }
                autoOpenDockTab(ctx)
                return
              }
            }
            attempts += 1
            if (attempts === 6 && disposeOverlay === null) disposeOverlay = registerOverlay(ctx)
            if (attempts < 20) timer = window.setTimeout(install, 500)
          }
          install()
          return function () {
            stopped = true
            try { window.clearTimeout(timer) } catch (error) { /* ignore */ }
            if (disposeDock !== null) {
              const off = disposeDock
              disposeDock = null
              try { off() } catch (error) { /* ignore */ }
            }
            if (disposeOverlay !== null) {
              const off = disposeOverlay
              disposeOverlay = null
              try { off() } catch (error) { /* ignore */ }
            }
          }
        }, 'task-monitor: native sidebar tab')
      },
    }
  },
})
