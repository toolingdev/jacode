import { For, type Component } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { WordmarkBlocks, WordmarkExtras } from "./wordmark-blocks"
import { useWordmarkStyle, wordmarkStyles } from "./wordmark-style"

// The letter slots that hold "jacode"; the first two slots of the wordmark are empty.
const SLOTS = [2, 3, 4, 5, 6, 7]

/** Fork feature: choose how the wordmark on the new session screen moves. Each tile plays its style. */
export const SettingsWordmark: Component = () => {
  const language = useLanguage()
  const wordmark = useWordmarkStyle()

  return (
    <div class="settings-section">
      <div class="flex flex-col gap-0.5">
        <h3 class="text-13-medium text-v2-text-text-base">{language.t("settings.wordmark.title")}</h3>
        <p class="text-12-regular text-v2-text-text-muted">{language.t("settings.wordmark.description")}</p>
      </div>
      <div
        role="radiogroup"
        aria-label={language.t("settings.wordmark.title")}
        class="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2 pt-3"
      >
        <For each={wordmarkStyles}>
          {(style) => (
            <button
              type="button"
              role="radio"
              aria-checked={wordmark.chosen.style === style}
              data-action="settings-wordmark-style"
              class="flex flex-col items-center gap-2 rounded-md border border-v2-border-border-muted p-3 text-12-regular text-v2-text-text-muted aria-checked:border-v2-border-border-strong aria-checked:bg-v2-background-bg-layer-01 aria-checked:text-v2-text-text-base"
              onClick={() => wordmark.setStyle(style)}
            >
              {/* The wordmark's own units, with room above for the companion and beside for the cursor. */}
              <svg viewBox="50 -24 206 72" class="w-full overflow-visible" aria-hidden="true">
                <For each={SLOTS}>{(slot) => <WordmarkBlocks slot={slot} style="plain" />}</For>
                <For each={SLOTS}>{(slot) => <WordmarkBlocks slot={slot} style={style} />}</For>
                <WordmarkExtras style={style} />
              </svg>
              {language.t(`settings.wordmark.style.${style}`)}
            </button>
          )}
        </For>
      </div>
    </div>
  )
}
