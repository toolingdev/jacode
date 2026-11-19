export * as VerseTool from "./verse.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Duration, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { Message } from "@opencode/ai/effect"
import type { Document, Entry } from "@opencode/schema/config"
import { Config } from "../../config.js"
import { ConfigEntryObserver } from "../../config/plugin/entry-observer.js"

// Fork feature: the Bible add-on. It comes with the app and is off until switched on in Settings › Add-ons
// (`experimental.addons.bible`). It offers the exact words of a Bible passage, so a reply quotes Scripture from the
// text rather than from a model's memory, optionally also in Spanish, and tells the model how to outline a sermon or
// study. The text comes from bible-api.com, which is free and needs no key; only the reference is sent. Every
// translation offered is in the public domain.

export const name = "verse"

export const description = `Get the exact text of a Bible passage by reference (such as "John 3:16", "Psalm 23" or "Romans 8:28-39"), in English and, when asked or set in Settings, also in Spanish. Write the book's name in English. Always use this to quote Scripture instead of quoting from memory. Translations are public domain: King James Version by default, and Reina-Valera 1909 for Spanish.`

export const Input = Schema.Struct({
  reference: Schema.String.annotate({ description: 'The passage, book name in English, e.g. "John 3:16-17" or "Psalm 23"' }),
  translation: Schema.Literals(["kjv", "web", "asv", "bsb"])
    .annotate({
      description:
        "The English translation: kjv (King James), web (World English Bible), asv (American Standard) or bsb (Berean Standard). Defaults to kjv.",
    })
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed("kjv" as const))),
  spanish: Schema.optionalKey(
    Schema.Boolean.annotate({
      description: "Also give the passage in Spanish (Reina-Valera 1909). Defaults to the add-on's setting.",
    }),
  ),
})

const Line = Schema.Struct({ chapter: Schema.Finite, verse: Schema.Finite, text: Schema.String })

const Passage = Schema.Struct({
  reference: Schema.String,
  translation: Schema.String,
  verses: Schema.Array(Line),
})
export type Passage = typeof Passage.Type

export const Output = Schema.Struct({
  reference: Schema.String,
  english: Passage,
  spanish: Schema.optionalKey(Passage),
})
export type Output = typeof Output.Type

const Answer = Schema.Struct({
  reference: Schema.String,
  verses: Schema.Array(
    Schema.Struct({ book_name: Schema.String, chapter: Schema.Finite, verse: Schema.Finite, text: Schema.String }),
  ),
  translation_name: Schema.String,
})

const SPANISH = "rv1909"
const TIMEOUT = Duration.seconds(12)

// A longer passage belongs in a Bible, not in a chat reply; the service also answers slowly for whole books.
const MOST_VERSES = 60

/** A service answer as a passage: the reference in that translation's own wording, each verse's text on one line. */
export function toPassage(answer: typeof Answer.Type): Passage {
  return {
    reference: answer.reference,
    translation: answer.translation_name,
    verses: answer.verses.slice(0, MOST_VERSES).map((line) => ({
      chapter: line.chapter,
      verse: line.verse,
      text: line.text.replace(/\s+/g, " ").trim(),
    })),
  }
}

/** The result as the short text the model reads. */
export function verseText(output: Output) {
  const lines = (passage: Passage) => [
    `${passage.reference} (${passage.translation})`,
    ...passage.verses.map((line) => `${line.chapter}:${line.verse} ${line.text}`),
  ]

  return [...lines(output.english), ...(output.spanish ? ["", ...lines(output.spanish)] : [])].join("\n")
}

/** The passage as the app's quote card takes it: one quote per language, each verse a line under its number. */
export function toCard(output: Output) {
  return {
    title: output.reference,
    quotes: [output.english, ...(output.spanish ? [output.spanish] : [])].map((passage) => ({
      lines: passage.verses.map((line) => ({ label: String(line.verse), text: line.text })),
      source: `${passage.reference} · ${passage.translation}`,
    })),
  }
}

/** The ready-made block that shows the result as a card in the desktop app; see the weather tool's. */
export function cardHint(output: Output) {
  return [
    "To show this as a quote card, put this block in your reply exactly as it is, fence included:",
    "```visual",
    // A verse may hold a "<", which must not end the script element early.
    `<quote-card><script type="application/json">${JSON.stringify(toCard(output)).replaceAll("<", "\\u003c")}</script></quote-card>`,
    "```",
  ].join("\n")
}

export const Plugin = {
  id: "opencode.tool.verse",
  effect: Effect.fn("VerseTool.Plugin")(function* (ctx: Context) {
    const http = yield* HttpClient.HttpClient
    const config = yield* Config.Service
    // Internal plugins are not re-run on config changes, so the tool is re-registered when the add-on is switched.
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, ctx.tool.reload())

    const read = (reference: string, translation: string) =>
      HttpClient.withScope(http)
        .execute(
          HttpClientRequest.get(`https://bible-api.com/${encodeURIComponent(reference.trim())}`).pipe(
            HttpClientRequest.setUrlParams({ translation }),
            HttpClientRequest.acceptJson,
          ),
        )
        .pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap(HttpClientResponse.schemaBodyJson(Answer)),
          Effect.map(toPassage),
          Effect.scoped,
          Effect.timeoutOrElse({ duration: TIMEOUT, orElse: () => Effect.fail(new Error("timed out")) }),
        )

    yield* ctx.session.hook("context", (event) =>
      Effect.sync(() => {
        const addon = bible(loaded.entries)

        if (!addon?.enabled) return
        const at = event.messages.findIndex((message) => message.role === "user")

        // Before the first prompt, and in the same place on every step so the cached prefix stays warm.
        if (at !== -1) event.messages.splice(at, 0, Message.user(instruction(addon.spanish === true)))
      }),
    )

    yield* ctx.tool
      .transform((editor) => {
        if (!bible(loaded.entries)?.enabled) return
        editor.add({
          name,
          // Called directly, as the weather tool is: the model must read the text result, which ends with the card.
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input) =>
            Effect.gen(function* () {
              const english = yield* read(input.reference, input.translation)

              // The Spanish is extra: the English still shows when that translation cannot be read.
              const spanish = (input.spanish ?? bible(loaded.entries)?.spanish === true)
                ? yield* read(input.reference, SPANISH).pipe(Effect.catch(() => Effect.succeed(undefined)))
                : undefined

              const output = { reference: english.reference, english, ...(spanish ? { spanish } : {}) }

              return { output, content: `${verseText(output)}\n\n${cardHint(output)}` }
            }).pipe(
              Effect.mapError(
                (error) =>
                  new ToolFailure({
                    message: `Unable to find "${input.reference}". Write the book's name in English, then chapter and verses, such as "John 3:16-17".`,
                    error,
                  }),
              ),
            ),
        })
      })
      .pipe(Effect.orDie)
  }),
}

/** The Bible add-on's settings, from the latest config that sets them; a later config of other options keeps them. */
export function bible(entries: readonly Entry[]) {
  return entries.findLast(
    (entry): entry is Document => entry.type === "document" && entry.info.experimental?.addons?.bible !== undefined,
  )?.info.experimental?.addons?.bible
}

/** What the model is told while the add-on is on. Model-facing, so it is not translated. */
export function instruction(bilingual: boolean) {
  return `<system-reminder>
The Bible add-on is on. Quote Scripture only from the verse tool, never from memory; its result ends with a ready-made fenced \`visual\` block holding a <quote-card>, to copy into the reply unchanged. A sermon or Bible study can be outlined with an <outline-card>, as for any talk or lesson.${bilingual ? " The user works in English and Spanish: in an <outline-card>, titleAlt, summaryAlt and closingAlt carry the same line in Spanish." : ""}
</system-reminder>`
}
