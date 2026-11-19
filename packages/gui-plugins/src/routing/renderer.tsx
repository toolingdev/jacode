import { ComposerPill, type ComposerPillProps, type Plugin } from "@opencode/plugin/gui"
import { lastDecision, shortModel } from "./decision"
import type definition from "./index"

/**
 * Fork feature: Auto made visible. In an Auto chat, a decision model reads every prompt and Auto answers it with the
 * model for that kind of task; this pill above the composer says which model answered the latest prompt and why.
 * With plans on, it also says whether the prompt was judged a large task.
 */
const setup: Plugin.Setup<typeof definition> = (ctx) => {
  // A model by the name the model picker shows, falling back to its short ID while the list loads.
  const modelName = (input: ComposerPillProps, key: string) => {
    const providerID = key.slice(0, key.indexOf("/"))
    const id = key.slice(key.indexOf("/") + 1)

    return (
      input.session.server.data.location.model
        .list(input.session.directory ? { directory: input.session.directory } : undefined)
        ?.findLast((item) => item.providerID === providerID && item.id === id)?.name ?? shortModel(key)
    )
  }

  ctx.add(ComposerPill, {
    id: "routing",
    order: 20,
    show: (input) => {
      const decision = lastDecision(input.session.server.data.session.message.list(input.session.id))
      const size = decision?.answers.find((answer) => answer.name === "size")
      const auto = decision?.auto
      const large = size?.choice === "large"

      // Outside Auto, only a prompt held for a plan is worth a pill.
      if (!auto && !large) return

      const task = decision?.answers.find((answer) => answer.name === "task")
      const percent = (confidence: number) => Math.round(confidence * 100)

      return {
        icon: "branch",
        title: ctx.t("title"),
        label: auto ? ctx.t("used", { model: modelName(input, auto.model) }) : ctx.t("plan"),
        rows: [
          ...(auto
            ? [
                { id: "model", label: ctx.t("row.model", { model: modelName(input, auto.model) }) },
                {
                  id: "tier",
                  label: ctx.t(`row.tier.${auto.tier}`),
                  detail:
                    auto.reason === "sure" && task
                      ? ctx.t("reason.sure", { percent: percent(task.confidence) })
                      : ctx.t(`reason.${auto.reason}`),
                },
              ]
            : []),
          ...(size
            ? [
                {
                  id: "size",
                  label: ctx.t(large ? "row.size.large" : "row.size.small"),
                  detail: ctx.t("sure", { percent: percent(size.confidence) }),
                },
              ]
            : []),
          {
            id: "settings",
            label: ctx.t("settings"),
            icon: "settings-gear" as const,
            run: () => ctx.layout.settings("models"),
          },
        ],
      }
    },
  })
}

export default setup
