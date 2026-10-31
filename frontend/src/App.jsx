import { useEffect, useRef, useState } from 'react'
import './App.css'
import AuthModal from './components/AuthModal'
import DiffViewer from './components/DiffViewer'
import ProjectTreeModal from './components/ProjectTreeModal'
import SearchBar from './components/SearchBar'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001'

const initialTasks = [
  {
    id: 'sample-navigation',
    title: 'Build a responsive navigation bar',
    type: 'UI Development',
    time: 'Today',
    status: 'Ready to start',
    symbol: '</>',
  },
  {
    id: 'sample-accessibility',
    title: 'Review accessibility issues',
    type: 'Accessibility',
    time: 'Yesterday',
    status: 'Planned',
    symbol: '✓',
  },
  {
    id: 'sample-performance',
    title: 'Optimize component performance',
    type: 'Performance',
    time: 'Yesterday',
    status: 'Planned',
    symbol: '↗',
  },
]

function formatTaskTime(createdAt) {
  const elapsed = Date.now() - new Date(createdAt).getTime()

  if (!Number.isFinite(elapsed) || elapsed < 0) return 'Recently'
  if (elapsed < 60_000) return 'Just now'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`

  return new Date(createdAt).toLocaleDateString()
}

function getStoredToken() {
  try {
    return localStorage.getItem('codepilot_token') || ''
  } catch {
    return ''
  }
}

function App() {
  const [prompt, setPrompt] = useState('')
  const [activeNav, setActiveNav] = useState('Overview')
  const [tasks, setTasks] = useState(initialTasks)
  const [backendStatus, setBackendStatus] = useState('checking')
  const [editorStatus, setEditorStatus] = useState('connecting')
  const [taskError, setTaskError] = useState('')
  const [taskSuccess, setTaskSuccess] = useState('')
  const [isLoadingTasks, setIsLoadingTasks] = useState(true)
  const [isSavingTask, setIsSavingTask] = useState(false)
  const [isGeneratingAi, setIsGeneratingAi] = useState(false)
  const [aiProgressStep, setAiProgressStep] = useState('')
  const [aiExplanation, setAiExplanation] = useState('')
  const [proposedDiffs, setProposedDiffs] = useState([])
  const [isApplyingDiff, setIsApplyingDiff] = useState(false)
  const [contextFiles, setContextFiles] = useState([])
  const [searchQuery, setSearchQuery] = useState('')

  // Auth state
  const [user, setUser] = useState(null)
  const [isAuthOpen, setIsAuthOpen] = useState(false)
  const [isTreeOpen, setIsTreeOpen] = useState(false)
  const [aiConfig, setAiConfig] = useState({ configured: false, model: 'openai/gpt-oss-120b' })

  const focusPromptAfterNavigation = useRef(false)
  const promptRef = useRef(null)
  const wsRef = useRef(null)

  // 1. Check backend health & AI status on boot
  useEffect(() => {
    const controller = new AbortController()

    async function checkBackend() {
      try {
        const response = await fetch(`${API_URL}/api/health`, {
          signal: controller.signal,
          credentials: 'include',
        })

        if (!response.ok) throw new Error(`HTTP error: ${response.status}`)
        const data = await response.json()

        if (data.success && data.status === 'healthy') {
          setBackendStatus('connected')
          if (data.ai) {
            setAiConfig({
              configured: Boolean(data.ai.configured),
              model: data.ai.model || 'llama-3.3-70b-versatile',
            })
          }
        } else {
          setBackendStatus('disconnected')
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          setBackendStatus('disconnected')
          console.error('Backend connection check failed:', error)
        }
      }
    }

    checkBackend()
    return () => controller.abort()
  }, [])

  // 2. Check and restore authentication session on boot
  useEffect(() => {
    const controller = new AbortController()
    const token = getStoredToken()

    async function restoreSession() {
      try {
        const headers = {}
        if (token) headers['Authorization'] = `Bearer ${token}`

        const res = await fetch(`${API_URL}/api/auth/me`, {
          signal: controller.signal,
          headers,
          credentials: 'include',
        })

        if (res.ok) {
          const data = await res.json()
          if (data.success && data.user) {
            setUser(data.user)
          }
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.log('Session check completed: No active session.')
        }
      }
    }

    restoreSession()
    return () => controller.abort()
  }, [])

  // 3. Connect to WebSocket Editor Bridge
  useEffect(() => {
    let ws = null
    let reconnectTimer = null

    function connectWs() {
      try {
        ws = new WebSocket(`${WS_URL}/ws/editor`)
        wsRef.current = ws

        ws.onopen = () => {
          setEditorStatus('connected')
        }

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            if (data.type === 'reveal_file') {
              setTaskSuccess(`Editor navigated to: ${data.payload?.path}:${data.payload?.line || 1}`)
            }
          } catch {
            // Ignore non-json frames
          }
        }

        ws.onclose = () => {
          setEditorStatus('standby')
          // Auto reconnect after 5 seconds
          reconnectTimer = setTimeout(connectWs, 5000)
        }

        ws.onerror = () => {
          setEditorStatus('standby')
        }
      } catch {
        setEditorStatus('standby')
      }
    }

    connectWs()

    return () => {
      clearTimeout(reconnectTimer)
      if (ws) ws.close()
    }
  }, [])

  // 4. Focus prompt on Workspace navigation
  useEffect(() => {
    if (activeNav === 'Workspace' && focusPromptAfterNavigation.current) {
      promptRef.current?.focus()
      focusPromptAfterNavigation.current = false
    }
  }, [activeNav])

  // 5. Load tasks from backend
  useEffect(() => {
    const controller = new AbortController()

    async function loadTasks() {
      try {
        const response = await fetch(`${API_URL}/api/tasks`, {
          signal: controller.signal,
          credentials: 'include',
        })

        if (!response.ok) throw new Error(`HTTP error: ${response.status}`)
        const data = await response.json()

        if (!data.success || !Array.isArray(data.tasks)) {
          throw new Error('The task list response was invalid.')
        }

        const savedTasks = data.tasks.map((task) => ({
          id: task.id,
          title: task.title,
          type: task.category,
          time: formatTaskTime(task.createdAt),
          status: 'Draft',
          symbol: '✳',
        }))

        setTasks([...savedTasks, ...initialTasks])
      } catch (error) {
        if (error.name !== 'AbortError') {
          setTaskError('Could not load saved tasks. Please check backend connection.')
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingTasks(false)
        }
      }
    }

    loadTasks()
    return () => controller.abort()
  }, [])

  // Action: Save regular task
  async function createTask(event) {
    if (event) event.preventDefault()
    const title = prompt.trim()
    if (!title || isSavingTask || isLoadingTasks || isGeneratingAi) return

    setTaskError('')
    setTaskSuccess('')
    setIsSavingTask(true)

    try {
      const response = await fetch(`${API_URL}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title }),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || `HTTP error: ${response.status}`)
      }

      const task = {
        id: data.task.id,
        title: data.task.title,
        type: data.task.category,
        time: 'Just now',
        status: 'Draft',
        symbol: '✳',
      }

      setTasks((prev) => [task, ...prev])
      setPrompt('')
      setTaskSuccess('Task saved to workspace.')
    } catch (error) {
      setTaskError(error.message || 'Could not save this task. Please try again.')
    } finally {
      setIsSavingTask(false)
    }
  }

  // Action: Execute AI prompt via Groq
  async function runAiGeneration() {
    const title = prompt.trim()
    if (!title || isGeneratingAi || isSavingTask) return

    if (!aiConfig.configured) {
      setTaskError(
        'Groq API is not configured. Please add GROQ_API_KEY in backend/.env to run live AI completions.'
      )
      return
    }

    setTaskError('')
    setTaskSuccess('')
    setIsGeneratingAi(true)
    setAiProgressStep('Validating instruction and assembling project context...')

    try {
      // Step update
      setTimeout(() => {
        setAiProgressStep(`Querying ${aiConfig.model} for solution architecture...`)
      }, 600)

      const token = getStoredToken()
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch(`${API_URL}/api/ai/generate`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          prompt: title,
          contextFiles,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || `AI generation failed (${res.status})`)
      }

      setAiExplanation(data.explanation || 'Proposed changes generated successfully.')
      setProposedDiffs(data.files || [])

      // Save a record of the AI task to task history
      const taskRecord = {
        id: `ai-${Date.now()}`,
        title: title,
        type: 'AI Generation',
        time: 'Just now',
        status: data.files?.length > 0 ? 'Reviewing' : 'Complete',
        symbol: '⌘',
      }
      setTasks((prev) => [taskRecord, ...prev])

      setTaskSuccess(
        `AI generated ${data.files?.length || 0} file change proposal(s). Review diffs below.`
      )
      setActiveNav('Workspace')
    } catch (err) {
      setTaskError(err.message || 'AI request failed.')
    } finally {
      setIsGeneratingAi(false)
      setAiProgressStep('')
    }
  }

  // Action: Apply proposed file change to disk
  async function handleApplyFile(fileToApply) {
    if (!fileToApply || isApplyingDiff) return

    if (!user) {
      setTaskError('Authentication required. Please sign in or register to modify project files.')
      setIsAuthOpen(true)
      return
    }

    setIsApplyingDiff(true)
    setTaskError('')
    setTaskSuccess('')

    try {
      const token = getStoredToken()
      const headers = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch(`${API_URL}/api/files/apply`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          path: fileToApply.path,
          content: fileToApply.proposedContent,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to apply file change.')
      }

      // Mark file as applied in state
      setProposedDiffs((prev) =>
        prev.map((f) => (f.path === fileToApply.path ? { ...f, isApplied: true } : f))
      )

      // Add task record
      const appliedTask = {
        id: `applied-${Date.now()}`,
        title: `Applied modifications to ${fileToApply.path}`,
        type: 'File Mutation',
        time: 'Just now',
        status: 'Applied',
        symbol: '✓',
      }
      setTasks((prev) => [appliedTask, ...prev])
      setTaskSuccess(`Successfully applied changes to ${fileToApply.path}!`)
    } catch (err) {
      setTaskError(err.message || 'Failed to write changes to disk.')
    } finally {
      setIsApplyingDiff(false)
    }
  }

  // Action: Send open file event over WebSocket to editor
  function handleRevealInEditor(filePath) {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'open_file',
          correlationId: `reveal-${Date.now()}`,
          payload: { path: filePath, line: 1 },
        })
      )
      setTaskSuccess(`Dispatched open command for ${filePath} to editor bridge.`)
    } else {
      setTaskError('Editor WebSocket bridge is currently in standby.')
    }
  }

  // Action: Logout
  async function handleLogout() {
    try {
      const token = getStoredToken()
      const headers = {}
      if (token) headers['Authorization'] = `Bearer ${token}`

      await fetch(`${API_URL}/api/auth/logout`, {
        method: 'POST',
        headers,
        credentials: 'include',
      })
    } catch {
      // Ignore network failure on logout
    } finally {
      localStorage.removeItem('codepilot_token')
      setUser(null)
      setTaskSuccess('Signed out successfully.')
    }
  }

  const navItems = [
    { label: 'Overview', icon: '◫' },
    { label: 'Workspace', icon: '⌘' },
    { label: 'Task history', icon: '◷' },
  ]
  const savedTasks = tasks.filter((task) => !task.id.startsWith('sample-'))
  const visibleTasks = searchQuery.trim()
    ? tasks.filter((t) => t.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : tasks
  const pageHeading = {
    Overview: {
      eyebrow: 'DEVELOPER WORKSPACE / OVERVIEW',
      title: 'Build with',
      highlightedTitle: 'intelligence.',
      description: 'Your workspace for building better frontend experiences.',
    },
    Workspace: {
      eyebrow: 'DEVELOPER WORKSPACE / WORKSPACE',
      title: 'Your project',
      highlightedTitle: 'workspace.',
      description: 'Create, review, and apply code changes directly in this workspace.',
    },
    'Task history': {
      eyebrow: 'DEVELOPER WORKSPACE / TASK HISTORY',
      title: 'Task',
      highlightedTitle: 'history.',
      description: 'Review tasks saved to this backend.',
    },
  }[activeNav]

  function renderComposer() {
    return (
      <section className="composer-section">
        <div className="section-heading">
          <div>
            <h2>What are we building today?</h2>
            <p>Describe a task or prompt the AI agent to generate reviewable code diffs.</p>
          </div>

          {aiConfig.configured ? (
            <span className="ai-label available-label" title={`Connected to Groq ${aiConfig.model}`}>
              <span aria-hidden="true" /> AI Agent Ready ({aiConfig.model.split('-')[0]})
            </span>
          ) : (
            <span
              className="ai-label unavailable-label"
              title="Configure GROQ_API_KEY in backend/.env to activate live completions"
            >
              AI API key required
            </span>
          )}
        </div>

        <form className="composer" onSubmit={createTask}>
          <label className="visually-hidden" htmlFor="task-prompt">
            Describe your frontend task
          </label>

          <textarea
            ref={promptRef}
            id="task-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                runAiGeneration();
              }
            }}
            placeholder="Describe a component, UI improvement, bug, or accessibility task... (Press Ctrl+Enter to Run with AI)"
            rows={3}
            maxLength={4000}
            aria-describedby="task-prompt-note"
            disabled={isGeneratingAi || isSavingTask}
          />

          {contextFiles.length > 0 && (
            <div className="ai-context-bar">
              <span style={{ color: '#8d9aaf' }}>Context:</span>
              {contextFiles.map((file) => (
                <span key={file} className="ai-context-chip">
                  📄 {file}
                  <button
                    type="button"
                    className="ai-context-remove-btn"
                    onClick={() => setContextFiles(contextFiles.filter((f) => f !== file))}
                    aria-label={`Remove ${file} from context`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="composer-footer">
            <div className="composer-tools">
              <span className="tool-chip">⌘ React</span>
              <span className="tool-chip">♿ Accessibility first</span>
              <span className="tool-chip">↗ Performance minded</span>
              <button
                type="button"
                className="ai-browse-btn"
                onClick={() => setIsTreeOpen(true)}
              >
                ＋ Attach File Context
              </button>
            </div>

            <div className="composer-controls-right">
              <button
                className="submit-button"
                type="submit"
                disabled={!prompt.trim() || isLoadingTasks || isSavingTask || isGeneratingAi}
              >
                {isSavingTask ? 'Saving...' : 'Save task'} <span>↗</span>
              </button>

              <button
                className="ai-run-btn"
                type="button"
                onClick={runAiGeneration}
                disabled={!prompt.trim() || isGeneratingAi || isSavingTask}
                title={aiConfig.configured ? 'Execute prompt with Groq AI' : 'Groq API key required in backend/.env'}
              >
                {isGeneratingAi ? 'Generating...' : 'Run with AI'} <span>✦</span>
              </button>
            </div>
          </div>
        </form>

        {isGeneratingAi && (
          <div className="ai-progress-box" role="status">
            <div className="ai-progress-status">
              <div className="spinner" aria-hidden="true" />
              <span>{aiProgressStep}</span>
            </div>
          </div>
        )}

        {aiExplanation && (
          <div className="ai-explanation-box">
            <h3>AI Architecture & Solution Plan</h3>
            <p>{aiExplanation}</p>
          </div>
        )}

        {(taskError || taskSuccess) && (
          <p
            className={`composer-note ${taskError ? 'task-error' : 'task-success'}`}
            id="task-prompt-note"
            role={taskError ? 'alert' : 'status'}
          >
            <span>{taskError ? '!' : '✓'}</span>
            {taskError || taskSuccess}
          </p>
        )}
      </section>
    )
  }

  function renderTaskTable(taskList, emptyMessage) {
    return (
      <div className="task-table">
        <div className="task-table-header" aria-hidden="true">
          <span>TASK</span>
          <span>CATEGORY</span>
          <span>UPDATED</span>
          <span>STATUS</span>
        </div>

        {isLoadingTasks ? (
          <p className="task-list-message" role="status">
            Loading saved tasks...
          </p>
        ) : taskError && tasks.length === initialTasks.length ? (
          <p className="task-list-message task-list-error" role="alert">
            Saved tasks could not be loaded. Check the backend connection and refresh this page.
          </p>
        ) : taskList.length === 0 ? (
          <p className="task-list-message">{emptyMessage}</p>
        ) : (
          taskList.map((task, index) => (
            <article className="task-row" key={task.id}>
              <div className="task-name-cell">
                <div
                  className={`task-symbol symbol-${index % 3}`}
                  aria-hidden="true"
                >
                  {task.symbol}
                </div>

                <div className="task-name">
                  <strong>{task.title}</strong>
                  <span>
                    {task.id.startsWith('sample-')
                      ? 'SAMPLE'
                      : `CP-${String(savedTasks.length - savedTasks.indexOf(task)).padStart(3, '0')}`}
                  </span>
                </div>
              </div>

              <span className="task-category">{task.type}</span>
              <span className="task-time">{task.time}</span>

              <span
                className={`task-status ${
                  task.status === 'Draft' ? 'draft' : task.status === 'Applied' ? 'applied' : ''
                }`}
              >
                <span aria-hidden="true" /> {task.status}
              </span>
            </article>
          ))
        )}
      </div>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" aria-label="CodePilot AI home">
          <span className="brand-mark">&lt;/&gt;</span>
          <span className="brand-name">
            CodePilot<span> AI</span>
          </span>
        </a>

        <button
          className="new-task-button"
          type="button"
          onClick={() => {
            if (activeNav === 'Workspace') {
              promptRef.current?.focus()
              return
            }
            focusPromptAfterNavigation.current = true
            setActiveNav('Workspace')
          }}
        >
          <span>＋</span> New task
        </button>

        <div className="nav-section">
          <p className="section-label">WORKSPACE</p>

          <nav className="nav-list" aria-label="Main navigation">
            {navItems.map((item) => (
              <button
                key={item.label}
                type="button"
                className={`nav-link ${activeNav === item.label ? 'selected' : ''}`}
                aria-current={activeNav === item.label ? 'page' : undefined}
                onClick={() => setActiveNav(item.label)}
              >
                <span className="nav-icon" aria-hidden="true">
                  {item.icon}
                </span>

                {item.label}

                {item.label === 'Workspace' && (savedTasks.length > 0 || proposedDiffs.length > 0) && (
                  <span className="nav-count">{proposedDiffs.length || savedTasks.length}</span>
                )}
              </button>
            ))}
          </nav>
        </div>

        <div className="sidebar-project">
          <p className="section-label">CURRENT PROJECT</p>

          <div className="project-row">
            <div className="project-icon">CP</div>
            <div className="project-details">
              <strong>CodePilot AI</strong>
              <span>React application</span>
            </div>
          </div>

          <div className="project-progress">
            <span />
          </div>

          <p className="project-caption">Active Phase</p>
        </div>

        <div className="sidebar-bottom">
          <div className="connection-indicator">
            <span className={`connection-dot connection-${backendStatus}`} />
            <span>
              {backendStatus === 'checking'
                ? 'Checking backend'
                : backendStatus === 'connected'
                  ? 'Backend connected'
                  : 'Backend disconnected'}
            </span>
          </div>

          <div className="connection-indicator" style={{ borderBottom: 0 }}>
            <span className={`connection-dot ${editorStatus === 'connected' ? 'connection-connected' : 'connection-checking'}`} />
            <span>
              {editorStatus === 'connected' ? 'Editor Bridge active' : 'Editor Bridge standby'}
            </span>
          </div>

          <div className="profile-row">
            <div className="avatar">
              {user ? user.name.slice(0, 2).toUpperCase() : 'CP'}
            </div>

            <div className="profile-details">
              <strong>{user ? user.name : 'Developer'}</strong>
              <span>{user ? user.email : 'Personal workspace'}</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="main-area" id="overview">
        <header className="topbar">
          <div className="breadcrumbs" aria-label="Breadcrumb">
            <span>Projects</span>
            <span className="crumb-divider">/</span>
            <strong>{activeNav}</strong>
          </div>

          <div className="topbar-right">
            <div className="topbar-auth">
              {user ? (
                <div className="auth-user-badge">
                  <span>👤</span>
                  <strong>{user.name}</strong>
                  <button
                    type="button"
                    className="auth-logout-btn"
                    onClick={handleLogout}
                    title="Sign out of CodePilot"
                  >
                    Logout
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="auth-btn-signin"
                  onClick={() => setIsAuthOpen(true)}
                >
                  Sign In / Register
                </button>
              )}
            </div>

            <span className="environment-badge">
              <span /> DEVELOPMENT
            </span>
          </div>
        </header>

        <div className="page-content">
          <section className="page-heading">
            <div>
              <p className="eyebrow">{pageHeading.eyebrow}</p>
              <h1>
                {pageHeading.title} <span>{pageHeading.highlightedTitle}</span>
              </h1>
              <p className="heading-description">{pageHeading.description}</p>
            </div>

            <div className="date-chip">
              <span className="date-icon">◷</span>
              Development workspace
            </div>
          </section>

          {activeNav === 'Overview' && (
            <section className="metrics-grid" aria-label="Project overview">
              <article className="metric-card">
                <div className="metric-top">
                  <span>PROJECT STATUS</span>
                  <span className="metric-icon cyan">⌘</span>
                </div>
                <div className="metric-value">Active</div>
                <div className="metric-bottom">
                  <span className="status-pill">
                    <span /> Operational
                  </span>
                  <span className="metric-note">Full Stack</span>
                </div>
              </article>

              <article className="metric-card">
                <div className="metric-top">
                  <span>TASKS IN WORKSPACE</span>
                  <span className="metric-icon violet">≡</span>
                </div>
                <div className="metric-value">
                  {String(tasks.length).padStart(2, '0')}
                </div>
                <div className="metric-bottom">
                  <span className="metric-note">
                    {savedTasks.length} saved tasks
                  </span>
                </div>
              </article>

              <article className="metric-card">
                <div className="metric-top">
                  <span>BACKEND CONNECTION</span>
                  <span className="metric-icon cyan">↔</span>
                </div>
                <div className="metric-value metric-pending">
                  {backendStatus === 'checking'
                    ? 'Checking...'
                    : backendStatus === 'connected'
                      ? 'Connected'
                      : 'Disconnected'}
                </div>
                <div className="metric-bottom">
                  <span className="metric-note">
                    {backendStatus === 'connected'
                      ? aiConfig.configured ? `Groq AI Active` : `API Healthy`
                      : 'Unable to reach backend'}
                  </span>
                </div>
              </article>
            </section>
          )}

          {(activeNav === 'Overview' || activeNav === 'Workspace') &&
            renderComposer()}

          {activeNav === 'Overview' && (
            <section className="tasks-section">
              <div className="section-heading tasks-heading">
                <div>
                  <h2>Recent tasks</h2>
                  <p>Your development priorities, all in one place.</p>
                </div>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setActiveNav('Task history')}
                >
                  View history <span>→</span>
                </button>
              </div>

              <div style={{ marginBottom: '14px' }}>
                <SearchBar
                  placeholder="Filter workspace tasks..."
                  onSearch={setSearchQuery}
                />
              </div>

              {renderTaskTable(visibleTasks.slice(0, 5), 'No matching tasks found.')}
            </section>
          )}

          {activeNav === 'Workspace' && (
            <>
              {proposedDiffs.length > 0 ? (
                <section className="tasks-section">
                  <div className="section-heading tasks-heading">
                    <div>
                      <h2>Proposed Code Diffs ({proposedDiffs.length})</h2>
                      <p>Inspect AI-generated unified diffs before applying to disk.</p>
                    </div>
                  </div>

                  <DiffViewer
                    files={proposedDiffs}
                    onApplyFile={handleApplyFile}
                    onOpenFile={handleRevealInEditor}
                    isApplying={isApplyingDiff}
                  />
                </section>
              ) : (
                <section className="preview-unavailable" aria-labelledby="preview-title">
                  <div className="preview-icon" aria-hidden="true">&lt;/&gt;</div>
                  <div>
                    <h2 id="preview-title">Review & Apply Proposed Code Changes</h2>
                    <p>
                      Use &ldquo;Run with AI&rdquo; in the composer above to generate code modifications.
                      Unified before-and-after diffs will appear here for safe review and one-click application.
                    </p>
                  </div>
                </section>
              )}

              <section className="tasks-section" style={{ marginTop: '36px' }}>
                <div className="section-heading tasks-heading">
                  <div>
                    <h2>All workspace tasks</h2>
                    <p>Saved tasks and illustrative examples.</p>
                  </div>
                </div>
                {renderTaskTable(tasks, 'No tasks yet. Add one above to begin.')}
              </section>
            </>
          )}

          {activeNav === 'Task history' && (
            <section className="tasks-section history-section">
              <div className="section-heading tasks-heading">
                <div>
                  <h2>Saved task history</h2>
                  <p>Only tasks saved to the backend appear here.</p>
                </div>
              </div>
              {renderTaskTable(
                savedTasks,
                'No saved tasks yet. Create a task in Workspace and it will appear here.'
              )}
            </section>
          )}

          <footer className="page-footer">
            <span>
              CodePilot AI
              <span className="footer-separator"> / </span>
              Developer workspace
            </span>

            <span>
              <span className="footer-dot" /> Production Ready
            </span>
          </footer>
        </div>
      </main>

      {/* Auth Modal */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        apiUrl={API_URL}
        onAuthSuccess={(userData) => {
          setUser(userData)
          setTaskSuccess(`Welcome back, ${userData.name}!`)
        }}
      />

      {/* Project Tree Modal */}
      <ProjectTreeModal
        isOpen={isTreeOpen}
        onClose={() => setIsTreeOpen(false)}
        apiUrl={API_URL}
        onSelectContextFile={(filePath) => {
          if (!contextFiles.includes(filePath)) {
            setContextFiles([...contextFiles, filePath])
          }
        }}
      />
    </div>
  )
}

export default App
