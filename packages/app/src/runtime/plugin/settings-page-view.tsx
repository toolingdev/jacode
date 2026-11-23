import { createContext, For, useContext } from "solid-js"
import { SettingsPanel } from "@/settings/navigation"
import { useSettingsSurface } from "@/settings/surface"
import { Contribution } from "./render"

// Fork feature: the plugin page being rendered, so its `SettingsLayout` can list the sections other plugins add to it.
const PageContext = createContext<string>()

/** The id of the plugin settings page rendering this, if any. */
export const usePluginSettingsPage = () => useContext(PageContext)

/** One settings panel per plugin page; the tab value is the SettingsPage id. */
export function PluginSettingsPages() {
  const surface = useSettingsSurface()

  return (
    <For each={surface.plugins.pages()}>
      {(item) => (
        <SettingsPanel value={item.value.id}>
          <PageContext.Provider value={item.value.id}>
            <Contribution plugin={item.plugin}>
              {() =>
                item.value.render({
                  get target() {
                    const view = surface.view()

                    return view.tab === item.value.id ? view.target : undefined
                  },
                })
              }
            </Contribution>
          </PageContext.Provider>
        </SettingsPanel>
      )}
    </For>
  )
}

/**
 * Plugin sections on a host settings page, in contribution order; with `section`, the plugin rows placed in
 * that host section, rendered where the host lists them.
 */
export function PluginSettingsSections(props: { page: string; section?: "general" }) {
  const surface = useSettingsSurface()

  return (
    <For each={surface.plugins.sections(props.page, props.section)}>
      {(item) => (
        // A section is not a page of its own, so a `SettingsLayout` inside it adds nothing again.
        <PageContext.Provider value={undefined}>
        <Contribution plugin={item.plugin}>
          {() =>
            item.value.render({
              get target() {
                return surface.view().target
              },
            })
          }
        </Contribution>
        </PageContext.Provider>
      )}
    </For>
  )
}
