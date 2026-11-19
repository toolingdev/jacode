import type { LocalProject } from "@/shell/state/layout"
import {
  displayName,
  getProjectAvatarGenerated,
  getProjectAvatarSource,
  getProjectAvatarColor,
  ProjectAvatar,
} from "@opencode/ui/project-avatar"

// The project avatar never changes while a session works: callers show `ActivityRing` at the row's trailing edge, as
// session tabs do.
export function SessionTabAvatarView(props: {
  project?: LocalProject
  directory: string
  unread: boolean
  /** The unread dot means a worker brought back a result. */
  remote?: boolean
  label?: string
}) {
  return (
    <ProjectAvatar
      fallback={displayName(props.project ?? { worktree: props.directory })}
      src={getProjectAvatarSource(props.project?.id, props.project?.icon)}
      variant={getProjectAvatarColor(props.project ?? { worktree: props.directory })}
      generated={getProjectAvatarGenerated(props.project ?? { worktree: props.directory })}
      label={props.label}
      unread={props.unread}
      unreadTone={props.remote ? "remote" : undefined}
    />
  )
}
