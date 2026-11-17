import { createEffect, onCleanup, type Component } from "solid-js"
import { idle, nextAnimation, paint, STAGE, type Animation } from "./animations"
import type { Sprite } from "./sprites"

const FRAME_MS = 110

/** An animation shorter than this many frames plays again before the next one starts. */
const MIN_FRAMES = 60

/**
 * One pixel character on its stage. While `thinking`, it plays its thinking animations one after another in random
 * order; otherwise it idles. With `still`, it holds one resting frame.
 */
export const Mascot: Component<{
  sprite: Sprite
  thinking: boolean
  still?: boolean
  /** The stage's edge in CSS pixels; a multiple of the stage size keeps pixels square. */
  size?: number
  label: string
}> = (props) => {
  let canvas: HTMLCanvasElement | undefined

  const draw = (animation: Animation, tick: number) => {
    const context = canvas?.getContext("2d")

    if (!context) return
    const frame = animation.frame(tick, props.sprite)

    context.clearRect(0, 0, STAGE, STAGE)
    context.globalAlpha = frame.alpha ?? 1

    for (const [x, y, color] of paint(props.sprite, frame)) {
      context.fillStyle = color
      context.fillRect(x, y, 1, 1)
    }
  }

  createEffect(() => {
    const sprite = props.sprite

    if (props.still) return draw(idle, 2)
    const thinking = props.thinking
    const play = { animation: thinking ? nextAnimation(sprite, undefined, Math.random) : idle, tick: 0 }

    draw(play.animation, 0)

    const timer = setInterval(() => {
      play.tick += 1

      if (thinking && play.tick >= Math.ceil(MIN_FRAMES / play.animation.length) * play.animation.length) {
        play.animation = nextAnimation(sprite, play.animation.id, Math.random)
        play.tick = 0
      }

      draw(play.animation, play.tick)
    }, FRAME_MS)

    onCleanup(() => clearInterval(timer))
  })

  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label={props.label}
      width={STAGE}
      height={STAGE}
      style={{
        width: `${props.size ?? STAGE * 2}px`,
        height: `${props.size ?? STAGE * 2}px`,
        "image-rendering": "pixelated",
        "flex-shrink": 0,
      }}
    />
  )
}
