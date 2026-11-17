import { describe, expect, test } from "bun:test"
import { VerseTool } from "../src/tool/plugin/verse"

const english = VerseTool.toPassage({
  reference: "John 3:16",
  translation_name: "King James Version",
  verses: [{ book_name: "John", chapter: 3, verse: 16, text: "For God so loved the world,\n that he gave <his> Son.\n" }],
})

describe("verse tool", () => {
  test("puts each verse's text on one line", () => {
    expect(english).toEqual({
      reference: "John 3:16",
      translation: "King James Version",
      verses: [{ chapter: 3, verse: 16, text: "For God so loved the world, that he gave <his> Son." }],
    })
  })

  test("words both languages when the Spanish was read", () => {
    const spanish = { reference: "Juan 3:16", translation: "Reina Valera 1909", verses: [{ chapter: 3, verse: 16, text: "Porque de tal manera" }] }

    expect(VerseTool.verseText({ reference: "John 3:16", english })).toBe(
      "John 3:16 (King James Version)\n3:16 For God so loved the world, that he gave <his> Son.",
    )
    expect(VerseTool.verseText({ reference: "John 3:16", english, spanish })).toContain(
      "\n\nJuan 3:16 (Reina Valera 1909)\n3:16 Porque de tal manera",
    )
  })

  test("hands the quote card one quote per language, each verse under its number", () => {
    expect(VerseTool.toCard({ reference: "John 3:16", english })).toEqual({
      title: "John 3:16",
      quotes: [
        {
          lines: [{ label: "16", text: "For God so loved the world, that he gave <his> Son." }],
          source: "John 3:16 · King James Version",
        },
      ],
    })
  })

  test("keeps a verse's text from ending the card's data early", () => {
    const hint = VerseTool.cardHint({ reference: "John 3:16", english })

    expect(hint).toContain("```visual\n<quote-card>")
    expect(hint).toContain("gave \\u003chis> Son.")
    expect(hint.match(/<\/script>/g)).toHaveLength(1)
  })
})
