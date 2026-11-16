import { expect, test } from "bun:test"
import { idle, nextAnimation, paint, shared, signature, STAGE, thinking } from "./animations"
import { sprites } from "./sprites"

test("every sprite is 16 rows of 8 cells drawn only with its palette", () => {
  for (const sprite of sprites) {
    expect(sprite.rows).toHaveLength(16)

    for (const row of sprite.rows) {
      expect(row).toHaveLength(8)
      expect(row.split("").filter((cell) => cell !== "." && !sprite.palette[cell])).toEqual([])
    }

    expect(sprite.palette[sprite.lid]).toBeDefined()
  }
})

test("every character has ten shared thinking animations and two of its own", () => {
  expect(shared).toHaveLength(10)

  for (const sprite of sprites) {
    expect(signature[sprite.id]).toHaveLength(2)
    const ids = thinking(sprite).map((animation) => animation.id)

    expect(new Set(ids).size).toBe(12)
  }

  expect(new Set(Object.values(signature).flatMap((own) => own.map((animation) => animation.id))).size).toBe(20)
})

test("every frame of every animation stays on the stage and draws the character", () => {
  for (const sprite of sprites) {
    for (const animation of [idle, ...thinking(sprite)]) {
      for (const tick of Array.from({ length: animation.length * 2 }, (_, index) => index)) {
        const pixels = paint(sprite, animation.frame(tick, sprite))

        expect(pixels.every(([x, y]) => x >= 0 && x < STAGE && y >= 0 && y < STAGE)).toBe(true)
        expect(pixels.every(([, , color]) => color !== "#ff00ff")).toBe(true)
      }

      expect(paint(sprite, animation.frame(0, sprite)).length).toBeGreaterThan(20)
    }
  }
})

test("the next animation is never the one that just played", () => {
  const sprite = sprites[0]

  for (const previous of thinking(sprite)) {
    for (const roll of [0, 0.5, 0.999]) {
      expect(nextAnimation(sprite, previous.id, () => roll).id).not.toBe(previous.id)
    }
  }
})
