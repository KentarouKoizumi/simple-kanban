import { useEffect, useMemo, useState } from 'react'
import {
  type CollisionDetection,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  BriefcaseBusiness,
  CheckCircle2,
  CirclePlus,
  FolderPlus,
  GripVertical,
  KanbanSquare,
  ListTodo,
  LoaderCircle,
  type LucideIcon,
  PencilLine,
  Trash2,
} from 'lucide-react'
import './App.css'

type Task = { id: string; title: string }
type Column = { id: string; title: string; taskIds: string[] }
type Workspace = {
  id: string
  name: string
  columnOrder: string[]
  columns: Record<string, Column>
  tasks: Record<string, Task>
}
type KanbanState = {
  activeWorkspaceId: string
  workspaceOrder: string[]
  workspaces: Record<string, Workspace>
}
type TaskLocation = { columnId: string; index: number }

const STORAGE_KEY = 'simple-kanban-v1'
const FALLBACK_WORKSPACE_NAME = '無題ワークスペース'
const COLUMN_TEMPLATE = [
  { id: 'todo', title: 'To Do' },
  { id: 'in-progress', title: 'Doing' },
  { id: 'done', title: 'Done' },
]
const COLUMN_THEME: Record<string, { icon: LucideIcon; className: string }> = {
  todo: {
    icon: ListTodo,
    className: 'column-theme-todo',
  },
  'in-progress': {
    icon: LoaderCircle,
    className: 'column-theme-in-progress',
  },
  done: {
    icon: CheckCircle2,
    className: 'column-theme-done',
  },
}
const collisionDetectionStrategy: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args)
  if (pointerCollisions.length > 0) {
    return pointerCollisions
  }

  return closestCorners(args)
}

const createId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

const createWorkspace = (name: string): Workspace => {
  const columns: Record<string, Column> = {}
  for (const column of COLUMN_TEMPLATE) {
    columns[column.id] = {
      id: column.id,
      title: column.title,
      taskIds: [],
    }
  }

  return {
    id: createId(),
    name,
    columnOrder: COLUMN_TEMPLATE.map((column) => column.id),
    columns,
    tasks: {},
  }
}

const isValidState = (value: unknown): value is KanbanState => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<KanbanState>
  if (!candidate.activeWorkspaceId || typeof candidate.activeWorkspaceId !== 'string') {
    return false
  }
  if (!Array.isArray(candidate.workspaceOrder) || candidate.workspaceOrder.length === 0) {
    return false
  }
  if (!candidate.workspaces || typeof candidate.workspaces !== 'object') {
    return false
  }

  return candidate.workspaceOrder.every((workspaceId) => {
    if (typeof workspaceId !== 'string') return false
    const workspace = (candidate.workspaces as Record<string, Workspace>)[workspaceId]
    return Boolean(workspace && typeof workspace === 'object')
  })
}

const loadState = (): KanbanState | null => {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return null
    }

    const parsed: unknown = JSON.parse(raw)
    if (!isValidState(parsed)) {
      return null
    }

    if (!parsed.workspaces[parsed.activeWorkspaceId]) {
      return {
        ...parsed,
        activeWorkspaceId: parsed.workspaceOrder[0],
      }
    }

    return parsed
  } catch {
    return null
  }
}

const createInitialState = (): KanbanState => {
  const firstWorkspace = createWorkspace('ワークスペース 1')
  return {
    activeWorkspaceId: firstWorkspace.id,
    workspaceOrder: [firstWorkspace.id],
    workspaces: {
      [firstWorkspace.id]: firstWorkspace,
    },
  }
}

const findTaskLocation = (workspace: Workspace, taskId: string): TaskLocation | null => {
  for (const columnId of workspace.columnOrder) {
    const index = workspace.columns[columnId].taskIds.indexOf(taskId)
    if (index !== -1) {
      return { columnId, index }
    }
  }
  return null
}

const moveTask = (
  workspace: Workspace,
  activeTaskId: string,
  over: NonNullable<DragEndEvent['over']>,
): Workspace => {
  const from = findTaskLocation(workspace, activeTaskId)
  if (!from) {
    return workspace
  }

  const overData = over.data.current as { type?: 'task' | 'column'; columnId?: string } | undefined
  let toColumnId: string | null = null
  let toIndex = -1

  if (overData?.type === 'column' && overData.columnId) {
    const destination = workspace.columns[overData.columnId]
    if (!destination) {
      return workspace
    }
    toColumnId = overData.columnId
    toIndex = destination.taskIds.length
  } else if (overData?.type === 'task' && overData.columnId) {
    const destination = workspace.columns[overData.columnId]
    if (!destination) {
      return workspace
    }
    toColumnId = overData.columnId
    toIndex = destination.taskIds.indexOf(String(over.id))
  } else {
    const fallback = findTaskLocation(workspace, String(over.id))
    if (!fallback) {
      return workspace
    }
    toColumnId = fallback.columnId
    toIndex = fallback.index
  }

  if (!toColumnId || toIndex < 0) {
    return workspace
  }

  if (from.columnId === toColumnId) {
    const sourceColumn = workspace.columns[from.columnId]
    const targetIndex = overData?.type === 'column' ? sourceColumn.taskIds.length - 1 : toIndex
    if (targetIndex < 0 || targetIndex === from.index) {
      return workspace
    }

    const reordered = arrayMove(sourceColumn.taskIds, from.index, targetIndex)
    return {
      ...workspace,
      columns: {
        ...workspace.columns,
        [sourceColumn.id]: {
          ...sourceColumn,
          taskIds: reordered,
        },
      },
    }
  }

  const sourceColumn = workspace.columns[from.columnId]
  const destinationColumn = workspace.columns[toColumnId]
  const nextSourceTaskIds = sourceColumn.taskIds.filter((taskId) => taskId !== activeTaskId)
  const nextDestinationTaskIds = [...destinationColumn.taskIds]
  const insertAt = overData?.type === 'column' ? nextDestinationTaskIds.length : toIndex
  nextDestinationTaskIds.splice(insertAt, 0, activeTaskId)

  return {
    ...workspace,
    columns: {
      ...workspace.columns,
      [sourceColumn.id]: {
        ...sourceColumn,
        taskIds: nextSourceTaskIds,
      },
      [destinationColumn.id]: {
        ...destinationColumn,
        taskIds: nextDestinationTaskIds,
      },
    },
  }
}

type TaskCardProps = {
  task: Task
  columnId: string
  onDeleteTask: (taskId: string, columnId: string) => void
}

const TaskCard = ({ task, columnId, onDeleteTask }: TaskCardProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'task', columnId },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <article
      className={`task-card ${isDragging ? 'is-dragging' : ''}`}
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
    >
      <div className="task-main">
        <span className="drag-indicator" aria-hidden>
          <GripVertical size={16} />
        </span>
        <p className="task-title">{task.title}</p>
      </div>
      <button
        className="icon-button danger"
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onClick={() => onDeleteTask(task.id, columnId)}
        aria-label="タスクを削除"
      >
        <Trash2 size={16} />
      </button>
    </article>
  )
}

type ColumnViewProps = {
  column: Column
  tasks: Task[]
  draft: string
  isDraggingTask: boolean
  onDraftChange: (columnId: string, value: string) => void
  onAddTask: (columnId: string) => void
  onDeleteTask: (taskId: string, columnId: string) => void
}

const ColumnView = ({
  column,
  tasks,
  draft,
  isDraggingTask,
  onDraftChange,
  onAddTask,
  onDeleteTask,
}: ColumnViewProps) => {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-drop-${column.id}`,
    data: { type: 'column', columnId: column.id },
  })
  const columnTheme = COLUMN_THEME[column.id] ?? COLUMN_THEME.todo
  const ColumnIcon = columnTheme.icon

  return (
    <section
      className={`kanban-column ${columnTheme.className} ${isDraggingTask ? 'drag-active' : ''} ${isOver ? 'drop-over' : ''}`}
      ref={setNodeRef}
    >
      <header className={`column-header ${columnTheme.className}`}>
        <h2>
          <span className="column-icon" aria-hidden>
            <ColumnIcon size={14} />
          </span>
          {column.title}
        </h2>
        <span className="column-count">{tasks.length}</span>
      </header>

      <div className="column-body">
        <form
          className="task-form"
          onSubmit={(event) => {
            event.preventDefault()
            onAddTask(column.id)
          }}
        >
          <input
            value={draft}
            onChange={(event) => onDraftChange(column.id, event.target.value)}
            placeholder="新しいタスク"
            aria-label={`${column.title}にタスクを追加`}
          />
          <button type="submit" className="primary-button small">
            <CirclePlus size={15} />
            追加
          </button>
        </form>

        <div className={`task-list ${isDraggingTask && isOver ? 'is-over' : ''}`}>
          <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
            {tasks.length === 0 ? (
              <p className="empty-column">ここにドロップ</p>
            ) : (
              tasks.map((task) => (
                <TaskCard key={task.id} task={task} columnId={column.id} onDeleteTask={onDeleteTask} />
              ))
            )}
          </SortableContext>
        </div>
      </div>
    </section>
  )
}

function App() {
  const [kanbanState, setKanbanState] = useState<KanbanState>(() => loadState() ?? createInitialState())
  const [taskDrafts, setTaskDrafts] = useState<Record<string, string>>({})
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null)
  const [workspaceNameDrafts, setWorkspaceNameDrafts] = useState<Record<string, string>>({})

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(kanbanState))
  }, [kanbanState])

  const activeWorkspace =
    kanbanState.workspaces[kanbanState.activeWorkspaceId] ??
    kanbanState.workspaces[kanbanState.workspaceOrder[0]]

  const activeTask = useMemo(() => {
    if (!activeTaskId || !activeWorkspace) {
      return null
    }
    return activeWorkspace.tasks[activeTaskId] ?? null
  }, [activeTaskId, activeWorkspace])

  const taskCount = activeWorkspace ? Object.keys(activeWorkspace.tasks).length : 0

  const handleWorkspaceSwitch = (workspaceId: string) => {
    setKanbanState((previous) => ({
      ...previous,
      activeWorkspaceId: workspaceId,
    }))
  }

  const handleWorkspaceCreate = () => {
    setKanbanState((previous) => {
      const workspaceName = `ワークスペース ${previous.workspaceOrder.length + 1}`
      const workspace = createWorkspace(workspaceName)

      return {
        activeWorkspaceId: workspace.id,
        workspaceOrder: [...previous.workspaceOrder, workspace.id],
        workspaces: {
          ...previous.workspaces,
          [workspace.id]: workspace,
        },
      }
    })
  }

  const handleWorkspaceEditStart = (workspaceId: string) => {
    const workspace = kanbanState.workspaces[workspaceId]
    if (!workspace) {
      return
    }

    setWorkspaceNameDrafts((previous) => ({
      ...previous,
      [workspaceId]: previous[workspaceId] ?? workspace.name,
    }))
    setEditingWorkspaceId(workspaceId)
  }

  const handleWorkspaceNameDraftChange = (workspaceId: string, value: string) => {
    setWorkspaceNameDrafts((previous) => ({
      ...previous,
      [workspaceId]: value,
    }))
  }

  const clearWorkspaceDraft = (workspaceId: string) => {
    setWorkspaceNameDrafts((previous) => {
      if (!(workspaceId in previous)) {
        return previous
      }
      const next = { ...previous }
      delete next[workspaceId]
      return next
    })
  }

  const handleWorkspaceNameCommit = (workspaceId: string, value: string) => {
    const normalized = value.trim() || FALLBACK_WORKSPACE_NAME

    setKanbanState((previous) => {
      const target = previous.workspaces[workspaceId]
      if (!target) {
        return previous
      }

      if (normalized === target.name) {
        return previous
      }

      return {
        ...previous,
        workspaces: {
          ...previous.workspaces,
          [workspaceId]: {
            ...target,
            name: normalized,
          },
        },
      }
    })

    clearWorkspaceDraft(workspaceId)
    setEditingWorkspaceId((previous) => (previous === workspaceId ? null : previous))
  }

  const handleWorkspaceNameCancel = (workspaceId: string) => {
    clearWorkspaceDraft(workspaceId)
    setEditingWorkspaceId((previous) => (previous === workspaceId ? null : previous))
  }

  const handleWorkspaceDelete = (workspaceId: string) => {
    setKanbanState((previous) => {
      if (previous.workspaceOrder.length <= 1) {
        return previous
      }

      const nextOrder = previous.workspaceOrder.filter((id) => id !== workspaceId)
      const nextWorkspaces = { ...previous.workspaces }
      delete nextWorkspaces[workspaceId]

      const previousIndex = previous.workspaceOrder.indexOf(workspaceId)
      const fallbackIndex = Math.max(0, previousIndex - 1)
      const nextActiveId =
        previous.activeWorkspaceId === workspaceId
          ? nextOrder[fallbackIndex] ?? nextOrder[0]
          : previous.activeWorkspaceId

      return {
        activeWorkspaceId: nextActiveId,
        workspaceOrder: nextOrder,
        workspaces: nextWorkspaces,
      }
    })
    clearWorkspaceDraft(workspaceId)
    setEditingWorkspaceId((previous) => (previous === workspaceId ? null : previous))
  }

  const handleTaskDraftChange = (columnId: string, value: string) => {
    setTaskDrafts((previous) => ({
      ...previous,
      [columnId]: value,
    }))
  }

  const handleAddTask = (columnId: string) => {
    const title = taskDrafts[columnId]?.trim()
    if (!title) {
      return
    }

    setKanbanState((previous) => {
      const workspace = previous.workspaces[previous.activeWorkspaceId]
      if (!workspace || !workspace.columns[columnId]) {
        return previous
      }

      const taskId = createId()
      const nextWorkspace: Workspace = {
        ...workspace,
        tasks: {
          ...workspace.tasks,
          [taskId]: {
            id: taskId,
            title,
          },
        },
        columns: {
          ...workspace.columns,
          [columnId]: {
            ...workspace.columns[columnId],
            taskIds: [taskId, ...workspace.columns[columnId].taskIds],
          },
        },
      }

      return {
        ...previous,
        workspaces: {
          ...previous.workspaces,
          [workspace.id]: nextWorkspace,
        },
      }
    })

    setTaskDrafts((previous) => ({
      ...previous,
      [columnId]: '',
    }))
  }

  const handleDeleteTask = (taskId: string, columnId: string) => {
    setKanbanState((previous) => {
      const workspace = previous.workspaces[previous.activeWorkspaceId]
      if (!workspace || !workspace.tasks[taskId]) {
        return previous
      }

      const nextTasks = { ...workspace.tasks }
      delete nextTasks[taskId]

      const targetColumn = workspace.columns[columnId]
      if (!targetColumn) {
        return previous
      }

      const nextWorkspace: Workspace = {
        ...workspace,
        tasks: nextTasks,
        columns: {
          ...workspace.columns,
          [columnId]: {
            ...targetColumn,
            taskIds: targetColumn.taskIds.filter((id) => id !== taskId),
          },
        },
      }

      return {
        ...previous,
        workspaces: {
          ...previous.workspaces,
          [workspace.id]: nextWorkspace,
        },
      }
    })
  }

  const handleDragStart = (event: DragStartEvent) => {
    setActiveTaskId(String(event.active.id))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTaskId(null)
    if (!event.over) {
      return
    }
    const over = event.over

    setKanbanState((previous) => {
      const workspace = previous.workspaces[previous.activeWorkspaceId]
      if (!workspace) {
        return previous
      }

      const nextWorkspace = moveTask(workspace, String(event.active.id), over)
      if (nextWorkspace === workspace) {
        return previous
      }

      return {
        ...previous,
        workspaces: {
          ...previous.workspaces,
          [workspace.id]: nextWorkspace,
        },
      }
    })
  }

  if (!activeWorkspace) {
    return null
  }

  return (
    <div className="app-shell">
      <aside className="workspace-sidebar">
        <div className="sidebar-head">
          <div className="brand">
            <KanbanSquare size={19} />
            <span>Simple Kanban</span>
          </div>
          <button className="primary-button small" type="button" onClick={handleWorkspaceCreate}>
            <FolderPlus size={15} />
            作成
          </button>
        </div>

        <div className="workspace-list">
          {kanbanState.workspaceOrder.map((workspaceId) => {
            const workspace = kanbanState.workspaces[workspaceId]
            if (!workspace) return null

            const isActive = workspaceId === activeWorkspace.id
            const isEditing = workspaceId === editingWorkspaceId
            return (
              <div className={`workspace-item ${isActive ? 'active' : ''}`} key={workspaceId}>
                <div className="workspace-switch">
                  <button
                    className="workspace-select"
                    type="button"
                    onClick={() => handleWorkspaceSwitch(workspaceId)}
                    aria-label={`${workspace.name || FALLBACK_WORKSPACE_NAME}を開く`}
                  >
                    <BriefcaseBusiness size={16} />
                  </button>
                  {isEditing ? (
                    <input
                      className="workspace-name-input"
                      value={workspaceNameDrafts[workspaceId] ?? workspace.name}
                      onChange={(event) => handleWorkspaceNameDraftChange(workspaceId, event.target.value)}
                      onBlur={(event) => handleWorkspaceNameCommit(workspaceId, event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          handleWorkspaceNameCommit(workspaceId, event.currentTarget.value)
                          return
                        }

                        if (event.key === 'Escape') {
                          event.preventDefault()
                          handleWorkspaceNameCancel(workspaceId)
                        }
                      }}
                      autoFocus
                      aria-label="ワークスペース名"
                    />
                  ) : (
                    <button
                      className="workspace-name-label"
                      type="button"
                      onClick={() => handleWorkspaceSwitch(workspaceId)}
                    >
                      {workspace.name || FALLBACK_WORKSPACE_NAME}
                    </button>
                  )}
                </div>
                <div className="workspace-actions">
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => {
                      handleWorkspaceSwitch(workspaceId)
                      handleWorkspaceEditStart(workspaceId)
                    }}
                    aria-label="ワークスペース名を変更"
                  >
                    <PencilLine size={14} />
                  </button>
                  <button
                    className="icon-button danger"
                    type="button"
                    onClick={() => handleWorkspaceDelete(workspaceId)}
                    disabled={kanbanState.workspaceOrder.length <= 1}
                    aria-label="ワークスペースを削除"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </aside>

      <main className="workspace-main">
        <header className="board-header">
          <div>
            <h1>{activeWorkspace.name || FALLBACK_WORKSPACE_NAME}</h1>
            <p>
              {taskCount} tasks / {kanbanState.workspaceOrder.length} workspaces
            </p>
          </div>
        </header>

        <section className="board-scroll-area">
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetectionStrategy}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveTaskId(null)}
          >
            <div className="kanban-board">
              {activeWorkspace.columnOrder.map((columnId) => {
                const column = activeWorkspace.columns[columnId]
                if (!column) {
                  return null
                }

                const tasks = column.taskIds
                  .map((taskId) => activeWorkspace.tasks[taskId])
                  .filter((task): task is Task => Boolean(task))

                return (
                  <ColumnView
                    key={column.id}
                    column={column}
                    tasks={tasks}
                    draft={taskDrafts[column.id] ?? ''}
                    isDraggingTask={Boolean(activeTaskId)}
                    onDraftChange={handleTaskDraftChange}
                    onAddTask={handleAddTask}
                    onDeleteTask={handleDeleteTask}
                  />
                )
              })}
            </div>

            <DragOverlay>
              {activeTask ? (
                <article className="task-card drag-overlay-card">
                  <div className="task-main">
                    <GripVertical size={16} />
                    <p className="task-title">{activeTask.title}</p>
                  </div>
                </article>
              ) : null}
            </DragOverlay>
          </DndContext>
        </section>
      </main>
    </div>
  )
}

export default App
