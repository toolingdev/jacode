import { expect, test } from "bun:test"
import { idle, nextAnimation, paint, STAGE, thinking, tinkering } from "./animations"
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

test("every character has ten thinking animations and shares none with another", () => {
  for (const sprite of sprites) expect(thinking(sprite)).toHaveLength(10)

  expect(new Set(sprites.flatMap((sprite) => thinking(sprite).map((animation) => animation.id))).size).toBe(100)
})

test("every character has three technical animations, and no animation shares its id with any other", () => {
  for (const sprite of sprites) expect(tinkering(sprite)).toHaveLength(3)

  expect(
    new Set(sprites.flatMap((sprite) => [...thinking(sprite), ...tinkering(sprite)].map((animation) => animation.id)))
      .size,
  ).toBe(130)
})

test("every frame of every animation stays on the stage and draws the character", () => {
  for (const sprite of sprites) {
    for (const animation of [idle, ...thinking(sprite), ...tinkering(sprite)]) {
      for (const tick of Array.from({ length: animation.length * 2 }, (_, index) => index)) {
        const pixels = paint(sprite, animation.frame(tick, sprite))

        expect(pixels.every(([x, y]) => x >= 0 && x < STAGE && y >= 0 && y < STAGE)).toBe(true)
        expect(pixels.every(([, , color]) => color !== "#ff00ff")).toBe(true)
      }

      // Some animations start or pass through an empty stage, but none stays empty.
      expect(
        Math.max(
          ...Array.from({ length: animation.length }, (_, tick) => paint(sprite, animation.frame(tick, sprite)).length),
        ),
      ).toBeGreaterThan(20)
    }
  }
})

test("the next animation is never the one that just played", () => {
  const sprite = sprites[0]

  for (const previous of [...thinking(sprite), ...tinkering(sprite)]) {
    for (const roll of [0, 0.5, 0.999]) {
      expect(nextAnimation(sprite, previous.id, () => roll).id).not.toBe(previous.id)
    }
  }
})
