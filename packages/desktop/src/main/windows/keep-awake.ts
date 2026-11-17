import { powerSaveBlocker } from "electron"

// Fork feature: keeps the computer from sleeping while a window asks for it, which windows do while a session of
// theirs is working. The display may still sleep; only the system stays up, so the work carries on.

// One blocker serves every window: it is held while at least one of them wants the computer awake.
const wanting = new Set<number>()

let blocker: number | undefined

export function setKeepAwake(client: number, enabled: boolean) {
  if (enabled) wanting.add(client)
  else wanting.delete(client)

  if (wanting.size > 0) {
    if (blocker === undefined || !powerSaveBlocker.isStarted(blocker))
      blocker = powerSaveBlocker.start("prevent-app-suspension")

    return
  }

  if (blocker !== undefined && powerSaveBlocker.isStarted(blocker)) powerSaveBlocker.stop(blocker)
  blocker = undefined
}
