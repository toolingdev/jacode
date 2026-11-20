import { Control, Description, ErrorMessage, Input, Label, Root, Thumb } from "@kobalte/core/switch"
import { createSignal, onCleanup, onMount, Show, splitProps } from "solid-js"
import type { ComponentProps, ParentProps } from "solid-js"
import { attachFigure } from "./figure"
import "./switch.css"

export interface SwitchProps extends ParentProps<ComponentProps<typeof Root>> {
  // I think we should consolidate - ask designers.
  appearance?: "standard" | "compact"
  hideLabel?: boolean
  description?: string
}

export function Switch(props: SwitchProps) {
  const [local, others] = splitProps(props, ["children", "class", "appearance", "hideLabel", "description"])

  return (
    <Root {...others} class={local.class} data-component="switch" data-appearance={local.appearance ?? "compact"}>
      <Input data-slot="switch-input" />
      <Show when={local.children}>
        {(label) => (
          <Label data-slot="switch-label" classList={{ "sr-only": local.hideLabel }}>
            {label()}
          </Label>
        )}
      </Show>
      <Show when={local.description}>
        <Description data-slot="switch-description">{local.description}</Description>
      </Show>
      <Control data-slot="switch-control">
        <Thumb data-slot="switch-thumb">
          <SwitchFigure />
        </Thumb>
      </Control>
      <ErrorMessage data-slot="switch-error" />
    </Root>
  )
}

// Fork feature: the Lissajous figure inside the thumb (see ./figure).
function SwitchFigure() {
  const [canvas, setCanvas] = createSignal<HTMLCanvasElement>()

  onMount(() => {
    const element = canvas()
    const thumb = element?.parentElement

    if (!element || !thumb) return
    onCleanup(attachFigure(element, thumb))
  })

  return <canvas ref={setCanvas} data-slot="switch-figure" aria-hidden="true" />
}
