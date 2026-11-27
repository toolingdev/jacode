export * as Config from "./config.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import path from "path"
import { isDeepStrictEqual } from "node:util"
import { applyEdits, findNodeAtLocation, modify, type ParseError, parse, parseTree } from "jsonc-parser"
import { Context, Effect, FiberMap, Layer, Option, PubSub, Ref, Schema, Semaphore, Stream } from "effect"
import { Directory, Document, Info, type Patch, type Entry, Event } from "@opencode/schema/config"
import type { ConfigExperimental } from "@opencode/schema/config/experimental"
import type { ConfigProvider } from "@opencode/schema/config/provider"
import type { Mcp } from "@opencode/schema/mcp"
import { App } from "./app.js"
import { Credential } from "./credential.js"
import { FlagResolve } from "./flag/resolve.js"
import { Bus } from "./bus.js"
import { Watcher } from "./filesystem/watcher.js"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { isRecord } from "@opencode/util/record"
import { Location } from "./location.js"
import { AbsolutePath } from "./schema.js"
import { ConfigVariable } from "./config/variable.js"
import { ConfigNormalize } from "./config/normalize.js"
import { ConfigSecrets } from "./config/secrets.js"
import { ConfigDiscovery } from "./config/discovery.js"
import { ConfigWatch } from "./config/watch.js"
import { ConfigIntegration } from "./config/integration.js"
import { ConfigManaged } from "./config/managed.js"
import { ManagedPolicy } from "./managed-policy.js"
import { Connection } from "@opencode/schema/connection"
import { WellKnown } from "./wellknown.js"
import { AppProcess } from "@opencode/util/process"
import { ChildProcess } from "effect/process"

/**
 * A config document's text without the entry at `at`, formatted as the edits here are. A document that has no such
 * entry comes back as it is: removing one whose parent is missing is an error to the JSON editor, and a fresh
 * config has none of the old-format sections these edits clear.
 */
export function withoutEntry(text: string, at: readonly string[]) {
  const root = parseTree(text)

  if (!root || !findNodeAtLocation(root, [...at])) return text

  return applyEdits(text, modify(text, [...at], undefined, { formattingOptions: { tabSize: 2, insertSpaces: true } }))
}

export function latest<K extends keyof Info>(entries: readonly Entry[], key: K): Info[K] | undefined {
  return entries.findLast((entry): entry is Document => entry.type === "document" && entry.info[key] !== undefined)
    ?.info[key]
}

export type IntegrationResult = ConfigIntegration.IntegrationResult

export interface Interface {
  /** Returns location config documents and discovery sources from lowest to highest priority. */
  readonly entries: () => Effect.Effect<Entry[]>
  /** Compatibility roots consumed by internal compatibility plugins. */
  readonly compatibility?: () => Effect.Effect<{
    readonly claude: readonly AbsolutePath[]
    readonly agents: readonly AbsolutePath[]
  }>
  /**
   * Streams raw filesystem updates under config roots. Config owns root
   * topology and watch reconciliation; domain owners filter this feed for the
   * source files they parse and rebuild their own state.
   */
  readonly changes: () => Stream.Stream<Watcher.Update>
  /** Updates supported global config fields while preserving unrelated JSONC content. */
  readonly update?: (patch: Patch) => Effect.Effect<void, FSUtil.Error>
  /**
   * Sets, or removes with `undefined`, one MCP server in the highest-precedence global config document, preserving
   * unrelated JSONC content. Removing a server another document defines leaves that definition in place.
   */
  readonly mcp?: (server: string, config: Mcp.ServerConfig | undefined) => Effect.Effect<void, FSUtil.Error>
  /**
   * Sets, or removes with `undefined`, one provider in the highest-precedence global config document, preserving
   * unrelated JSONC content. Removing a provider another document defines leaves that definition in place.
   */
  readonly provider?: (id: string, config: ConfigProvider.Info | undefined) => Effect.Effect<void, FSUtil.Error>
  /**
   * Fork feature: a provider's entry as the global config file writes it, with `{env:...}` references kept and any
   * secret written out in full hidden, and that file's path.
   */
  readonly providerEntry?: (id: string) => Effect.Effect<{ readonly path: string; readonly entry: unknown }>
  /**
   * Fork feature: switches a provider off or back on, as a `provider.use` deny policy in the global config file. Off
   * keeps its key and settings; the provider just goes unused until switched on.
   */
  readonly providerSwitch?: (id: string, enabled: boolean) => Effect.Effect<void, FSUtil.Error>
  /** Fork feature: replaces a provider's entry as edited in the app; hidden secrets keep the value the file has. */
  readonly providerEdit?: (id: string, entry: ConfigProvider.Info) => Effect.Effect<void, FSUtil.Error>
  /**
   * Fork feature: sets, or removes with `undefined`, the decision layer's settings in the highest-precedence global
   * config document, preserving unrelated JSONC content.
   */
  readonly decisions?: (settings: ConfigExperimental.Decisions | undefined) => Effect.Effect<void, FSUtil.Error>
  /** Fork feature: saves the weather tool's sources in the global config, or removes them to go back to the defaults. */
  readonly weather?: (settings: ConfigExperimental.Weather | undefined) => Effect.Effect<void, FSUtil.Error>
  /** Fork feature: saves the time tool's NTP servers in the global config, or removes them to use the defaults. */
  readonly time?: (settings: ConfigExperimental.Time | undefined) => Effect.Effect<void, FSUtil.Error>
  /** Fork feature: saves which add-ons that come with the app are switched on. */
  readonly addons?: (settings: ConfigExperimental.Addons | undefined) => Effect.Effect<void, FSUtil.Error>
  /** Fork feature: saves the workers chats may schedule tasks on, or removes them. */
  readonly workers?: (settings: ConfigExperimental.Workers | undefined) => Effect.Effect<void, FSUtil.Error>
  /**
   * Fork feature: adds or removes one entry of the `plugins` or `skills` list in the highest-precedence global config
   * document, preserving unrelated JSONC content. Adding an entry already listed and removing one that is not change
   * nothing; an entry another document lists stays configured.
   */
  readonly listed?: (key: "plugins" | "skills", entry: string, present: boolean) => Effect.Effect<void, FSUtil.Error>
  /**
   * Replaces, or clears with `undefined`, the document an integration connection contributes. It loads right after
   * managed policies: its settings layer below remote, user, and project config, while its policies outrank theirs.
   * Changing it reloads config like any other source.
   */
  readonly integration?: (
    integrationID: ConfigIntegration.Document["integrationID"],
    document: ConfigIntegration.Document | undefined,
  ) => Effect.Effect<IntegrationResult>
}

export const Options = Schema.Struct({
  project: Schema.optional(Schema.Boolean),
  // false skips the system and global config dirs, ~/.claude, and ~/.agents;
  // wellknown, file, and content entries still load.
  global: Schema.optional(Schema.Boolean),
  system: Schema.optional(Schema.Union([Schema.Boolean, Schema.String])),
  // false skips ~/.claude and project .claude dirs.
  claude: Schema.optional(Schema.Boolean),
  file: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
})
export type Options = typeof Options.Type

export class Service extends Context.Service<Service, Interface>()("@opencode/Config") {}

export interface TestInterface extends Interface {
  /** Replaces the entries returned by subsequent entries() calls. */
  readonly setEntries: (entries: Entry[]) => Effect.Effect<void>
  /** Emits one filesystem update to every changes() subscriber. */
  readonly emitChange: (update: Watcher.Update) => Effect.Effect<void>
}

export class Test extends Context.Service<Test, TestInterface>()("@opencode/Config/Test") {}

/** In-memory config for tests: static entries with replaceable state and a test-driven change feed. */
export const testLayer = (
  initial: Entry[] = [],
  compatibility: { readonly claude: readonly AbsolutePath[]; readonly agents: readonly AbsolutePath[] } = {
    claude: [],
    agents: [],
  },
) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const entries = yield* Ref.make(initial)
      const integrations = yield* Ref.make(new Map<string, ConfigIntegration.Document>())
      const updates = yield* PubSub.unbounded<Watcher.Update>()
      const service = Test.of({
        entries: () =>
          Effect.all([Ref.get(integrations), Ref.get(entries)]).pipe(
            Effect.map(([documents, entries]) => [...documents.values(), ...entries]),
          ),
        compatibility: () => Effect.succeed(compatibility),
        changes: () => Stream.fromPubSub(updates),
        setEntries: (next) => Ref.set(entries, next),
        emitChange: (update) => PubSub.publish(updates, update).pipe(Effect.asVoid),
        integration: (integrationID, document) =>
          Ref.update(integrations, (current) => {
            // Like config, keeps the document it holds when handed a deep-equal one.
            if (isDeepStrictEqual(current.get(integrationID), document)) return current
            const next = new Map(current)
            next.delete(integrationID)
            return document ? next.set(integrationID, document) : next
          }).pipe(
            Effect.andThen(Ref.get(integrations)),
            Effect.map((documents): IntegrationResult => {
              const document = documents.get(integrationID)
              return document ? { _tag: "Applied", document } : { _tag: "Cleared" }
            }),
          ),
      })
      return Context.empty().pipe(Context.add(Service, service), Context.add(Test, service))
    }),
  )

export const layer = (options?: Options) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const location = yield* Location.Service
      const watcher = yield* Watcher.Service
      const bus = yield* Bus.Service
      const credentials = yield* Credential.Service
      const globalService = yield* Global.Service
      const wellknown = yield* WellKnown.Service
      const processes = yield* AppProcess.Service
      const app = yield* App.Service
      const overrides = yield* FlagResolve.Overrides
      const integrations = new Map<string, ConfigIntegration.Document>()
      // Integrations set their documents from outside this layer, so their reloads run with its services.
      const context = yield* Effect.context<FSUtil.Service | Global.Service | Location.Service>()
      const reloadLock = Semaphore.makeUnsafe(1)
      const updateLock = Semaphore.makeUnsafe(1)
      const decodeOptions = { errors: "all", onExcessProperty: "ignore" } as const
      const decodeInfo = Schema.decodeUnknownOption(Info, decodeOptions)
      const parseInfo = Effect.fn("Config.parseInfo")(function* (text: string, source: string) {
        const errors: ParseError[] = []
        const input: unknown = parse(text, errors, { allowTrailingComma: true })
        if (errors.length) {
          yield* Effect.logWarning("configuration normalization diagnostic", {
            source,
            path: "$",
            kind: "invalid",
            action: "rejected malformed JSON or JSONC document",
          })
          return
        }
        const result = ConfigNormalize.normalize(input)
        // Every reload repeats routine notes. Rejected configs and dropped malformed or removed settings need a warning.
        yield* Effect.forEach(result.diagnostics, (diagnostic) => {
          const warn = result.type === "rejected" || diagnostic.kind === "invalid" || diagnostic.kind === "removed"
          const log = warn ? Effect.logWarning : Effect.logDebug
          return log("configuration normalization diagnostic", {
            source,
            path: diagnostic.path[0] === "$" ? "$" : `$.${diagnostic.path.join(".")}`,
            kind: diagnostic.kind,
            action: diagnostic.message,
          })
        })
        if (result.type === "rejected") return
        const info = Option.getOrUndefined(decodeInfo(result.encoded))
        if (info) return info
        yield* Effect.logWarning("configuration normalization diagnostic", {
          source,
          path: "$",
          kind: "invalid",
          action: "rejected canonical configuration after final validation",
        })
      })

      const loadFile = Effect.fnUntraced(function* (filepath: string, references: Set<string>) {
        const text = yield* fs.readFileStringSafe(filepath)
        if (text === undefined) return
        references.add(filepath)
        const substituted = yield* ConfigVariable.substitute({ type: "path", path: filepath, text, references })
        const info = yield* parseInfo(substituted, filepath)
        if (!info) return
        return new Document({ type: "document", path: AbsolutePath.make(filepath), info })
      })

      const loadWellknownEntry = Effect.fnUntraced(function* (entry: WellKnown.Entry, references: Set<string>) {
        const auth = entry.manifest.auth
        const credential = (yield* credentials.list(entry.integrationID)).at(-1)
        const variables = auth && credential?.value.type === "key" ? { [auth.env]: credential.value.key } : undefined
        // Logging out drops the saved remote config, so the source supplies nothing until a fresh fetch succeeds.
        if (!variables) return yield* wellknown.clearCached(entry.origin).pipe(Effect.as([]))
        // A failed refresh keeps the last resolved config so remote providers and allowlists do not disappear.
        const configs = yield* wellknown
          .resolve(entry, variables)
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("failed to load wellknown config", { source: entry.origin, error }).pipe(
                Effect.andThen(wellknown.cached(entry.origin)),
              ),
            ),
          )
        return yield* Effect.forEach(configs, (config) =>
          ConfigVariable.substitute({
            type: "virtual",
            source: entry.origin,
            dir: entry.origin,
            text: JSON.stringify(config),
            env: variables,
            references,
          }).pipe(
            Effect.flatMap((text) => parseInfo(text, entry.origin)),
            Effect.map((info) =>
              info
                ? new ConfigIntegration.WellKnownDocument({
                    type: "document",
                    info,
                    integrationID: entry.integrationID,
                  })
                : undefined,
            ),
          ),
        ).pipe(Effect.map((documents) => documents.filter((document) => document !== undefined)))
      })

      const loadWellknown = Effect.fn("Config.loadWellknown")(function* (references: Set<string>) {
        const entries = yield* wellknown
          .entries()
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("failed to discover wellknown config", { error }).pipe(Effect.as([] as const)),
            ),
          )
        return yield* Effect.forEach(entries, (entry) =>
          loadWellknownEntry(entry, references).pipe(
            Effect.map((documents) => ({ integrationID: entry.integrationID, documents })),
          ),
        )
      })

      // `integration.use` decides whether an integration may supply anything. Only managed policies can withhold the
      // documents an integration delivers, so a project file can never strip the Console document carrying org policy.
      // A withheld document keeps its policies, so denying an integration never lifts the restrictions it carries.
      const supplies = Effect.fnUntraced(function* (
        lockdown: ReturnType<typeof ManagedPolicy.statements>,
        integrationID: string,
        connection?: Connection.Info,
      ) {
        const stored =
          connection?.type === "credential" ? yield* credentials.get(Credential.ID.make(connection.id)) : undefined
        const resource = ManagedPolicy.integrationResource(
          integrationID,
          stored ? ManagedPolicy.account(stored.value) : undefined,
        )
        return ManagedPolicy.decision(lockdown, "integration.use", resource) !== "deny"
      })

      const loadPreferences = Effect.fn("Config.loadPreferences")(function* (
        plist: AbsolutePath,
        references: Set<string>,
      ) {
        const result = yield* processes
          .run(ChildProcess.make("plutil", ["-convert", "json", "-o", "-", plist], { stdin: "ignore" }), {
            timeout: "10 seconds",
          })
          .pipe(Effect.flatMap(AppProcess.requireSuccess), Effect.option)
        if (Option.isNone(result)) {
          yield* Effect.logWarning("failed to convert managed preferences", { source: plist })
          return []
        }
        references.add(plist)
        const text = yield* ConfigVariable.substitute({
          type: "virtual",
          source: plist,
          dir: path.dirname(plist),
          text: ConfigDiscovery.stripPreferenceMetadata(result.value.stdout.toString()),
          references,
        })
        const info = yield* parseInfo(text, plist)
        return info ? [new Document({ type: "document", path: plist, info })] : []
      })

      const loadDirectory = Effect.fnUntraced(function* (directory: AbsolutePath, references: Set<string>) {
        return [
          ...(yield* Effect.forEach(ConfigDiscovery.names, (file) =>
            loadFile(path.join(directory, file), references),
          ).pipe(Effect.map((configs) => configs.filter((config): config is Document => config !== undefined)))),
          new Directory({ type: "directory", path: directory }),
        ]
      })

      const load = Effect.fn("Config.load")(function* (sources: ConfigDiscovery.Sources) {
        const references = new Set<string>()
        const direct = yield* Effect.forEach(sources.direct, (filepath) => loadFile(filepath, references)).pipe(
          Effect.orDie,
          Effect.map((entries) => entries.filter((entry): entry is Document => entry !== undefined)),
        )

        const explicit = sources.explicit
          ? yield* loadFile(sources.explicit, references).pipe(
              Effect.map((config) => (config ? [config] : [])),
              Effect.orDie,
            )
          : []
        const content =
          options?.content !== undefined
            ? yield* ConfigVariable.substitute({
                type: "virtual",
                source: "OPENCODE_CONFIG_CONTENT",
                dir: location.directory,
                text: options.content,
                references,
              }).pipe(
                Effect.flatMap((text) => parseInfo(text, "OPENCODE_CONFIG_CONTENT")),
                Effect.map((info) => (info ? [new Document({ type: "document", info })] : [])),
                Effect.orDie,
              )
            : []

        // Managed settings load last so they override everything, and MDM
        // preferences outrank the system directory as in V1. Policies evaluate
        // in reverse load order, so managed policies split off and load first
        // to keep final file-based authority.
        const managed = [
          ...(sources.system?.present ? yield* loadDirectory(sources.system.path, references).pipe(Effect.orDie) : []),
          ...(sources.preferences ? yield* loadPreferences(sources.preferences, references).pipe(Effect.orDie) : []),
        ]
        const managedPolicies = managed
          .flatMap((entry) =>
            entry.type === "document" && entry.info.policies
              ? [
                  new ConfigManaged.Document({
                    type: "document",
                    path: entry.path,
                    info: new Info({ policies: entry.info.policies }),
                  }),
                ]
              : [],
          )
          .toReversed()
        const managedSettings = managed.map((entry) =>
          entry.type === "document"
            ? new ConfigManaged.Document({ ...entry, info: new Info({ ...entry.info, policies: undefined }) })
            : entry,
        )
        // Integration documents load right after managed policies: every remote, user, and project layer overrides
        // their settings, and since policies evaluate earliest-loaded first, only managed policies outrank theirs.
        // Global entries sit below explicit and direct files; project directories rank above them.
        const globalSupplementary = sources.global
          ? yield* loadDirectory(sources.global, references).pipe(Effect.orDie)
          : []
        const projectSupplementary = yield* Effect.forEach(
          sources.project.filter((root) => root.present),
          (root) => loadDirectory(root.path, references),
        ).pipe(
          Effect.orDie,
          Effect.map((entries) => entries.flat()),
        )
        const lockdown = ManagedPolicy.statements(managedPolicies)
        const integrated = yield* Effect.forEach(integrations.values(), (document) =>
          supplies(lockdown, document.integrationID, document.connection).pipe(
            Effect.map((allowed) => ConfigIntegration.result(document, allowed)),
          ),
        )
        const wellknownDocuments = yield* Effect.forEach(yield* loadWellknown(references).pipe(Effect.orDie), (entry) =>
          supplies(lockdown, entry.integrationID).pipe(
            Effect.map((allowed) =>
              allowed
                ? entry.documents
                : entry.documents.map(
                    (document) =>
                      new ConfigIntegration.WellKnownDocument({
                        ...document,
                        info: new Info({ policies: document.info.policies }),
                      }),
                  ),
            ),
          ),
        )
        const below = [
          ...managedPolicies,
          ...integrated.map((result) => result.document),
          ...wellknownDocuments.flat(),
          ...globalSupplementary,
          ...explicit,
          ...direct,
          ...projectSupplementary,
        ]
        const above = [...content, ...managedSettings]
        // Config can't read the Flag service, which reads Config, so it resolves project_overlay from everything but
        // the overlay itself.
        const overlay = FlagResolve.resolve({ entries: [...below, ...above], channel: app.channel, overrides })
          .project_overlay.enabled
          ? yield* ConfigDiscovery.overlay(options)
          : undefined
        const effective = overlay ? { ...sources, project: [...sources.project, overlay] } : sources
        return {
          integrationResults: new Map(integrated.map((result) => [result.document.integrationID, result])),
          configs: [
            ...below,
            ...(overlay?.present ? yield* loadDirectory(overlay.path, references).pipe(Effect.orDie) : []),
            ...above,
          ],
          sources: effective,
          isInput: yield* ConfigWatch.inputs(effective, references),
        }
      })

      const initial = yield* ConfigDiscovery.discover(options)
      let { configs, isInput, sources, integrationResults } = yield* load(initial)
      const updates = yield* PubSub.unbounded<Watcher.Update>()
      const reloads = yield* PubSub.sliding<void>(1)
      // Readiness rescans recover writes made before a watch attached.
      const requestReload = PubSub.publish(reloads, undefined).pipe(Effect.asVoid)
      const watched = yield* FiberMap.make<string>()
      const reconcile = Effect.fn("Config.reconcileWatches")(function* (sources: ConfigDiscovery.Sources) {
        const plan = ConfigWatch.plan(sources)
        for (const key of Array.from(watched, ([key]) => key)) {
          if (!plan.has(key)) yield* FiberMap.remove(watched, key)
        }
        for (const [key, target] of plan) {
          let real = target.path
          const ready = Effect.gen(function* () {
            real = yield* fs.resolve(target.path)
            yield* requestReload
          })
          yield* watcher.subscribe(target, ready).pipe(
            Effect.flatMap(
              Stream.runForEach((update) =>
                Effect.gen(function* () {
                  yield* PubSub.publish(updates, update)
                  if (isInput(update.path)) return yield* requestReload
                  // Native watches can report the canonical path even after the root was deleted.
                  if (real === target.path || !FSUtil.contains(real, update.path)) return
                  if (isInput(path.join(target.path, path.relative(real, update.path)))) yield* requestReload
                }),
              ),
            ),
            FiberMap.run(watched, key, { onlyIfMissing: true, startImmediately: true }),
          )
        }
      })

      const reloadUnlocked = Effect.fn("Config.reload")(function* () {
        const next = yield* load(yield* ConfigDiscovery.discover(options))
        isInput = next.isInput
        integrationResults = next.integrationResults
        yield* reconcile(next.sources)
        const compatibilityChanged =
          !isDeepStrictEqual(sources.claude, next.sources.claude) ||
          !isDeepStrictEqual(sources.agents, next.sources.agents)
        if (isDeepStrictEqual(configs, next.configs) && !compatibilityChanged) return
        sources = next.sources
        configs = next.configs
        yield* bus.publish(Event.Updated, {})
      })

      const reload = () => reloadLock.withPermit(reloadUnlocked())

      // Subscribe eagerly so synchronous watch readiness isn't dropped.
      const pendingReloads = yield* PubSub.subscribe(reloads)
      yield* Stream.fromSubscription(pendingReloads).pipe(
        Stream.debounce("100 millis"),
        Stream.runForEach(() =>
          reload().pipe(Effect.catchCause((cause) => Effect.logError("failed to reload config", { cause }))),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* bus.subscribe(Credential.Event.Switched).pipe(
        Stream.filterEffect((event) =>
          wellknown.entries().pipe(
            Effect.map((entries) => entries.some((entry) => entry.integrationID === event.data.integrationID)),
            Effect.orElseSucceed(() => false),
          ),
        ),
        Stream.runForEach(() =>
          reload().pipe(Effect.catchCause((cause) => Effect.logError("failed to reload wellknown config", { cause }))),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* bus.subscribe(WellKnown.Event.Updated).pipe(
        Stream.runForEach(() =>
          reload().pipe(Effect.catchCause((cause) => Effect.logError("failed to reload wellknown sources", { cause }))),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* Effect.sleep("10 minutes").pipe(
        Effect.andThen(
          Effect.suspend(() => {
            if (!wellknown.snapshot().length) return Effect.void
            return Effect.gen(function* () {
              const changed = yield* wellknown
                .refresh()
                .pipe(
                  Effect.catch((error) =>
                    Effect.logWarning("failed to refresh wellknown manifests", { error }).pipe(Effect.as(false)),
                  ),
                )
              if (!changed) yield* reload()
            }).pipe(Effect.catchCause((cause) => Effect.logWarning("failed to refresh wellknown config", { cause })))
          }),
        ),
        Effect.forever,
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* reloadLock.withPermit(reconcile(sources))

      const update = Effect.fn("Config.update")(
        function* (patch: Patch) {
          const directory = initial.global ?? AbsolutePath.make(globalService.config)
          const candidates = ConfigDiscovery.names.map((name) => path.join(directory, name))
          const filepath =
            (yield* Effect.filter(candidates, fs.isFile)).at(-1) ?? path.join(directory, "opencode.jsonc")
          const text = (yield* fs.readFileStringSafe(filepath)) ?? "{}\n"
          // Only the fields the patch names change; null removes one.
          const fields = [
            ...("shell" in patch ? [{ path: ["shell"], value: patch.shell ?? undefined }] : []),
            ...("computer" in patch ? [{ path: ["experimental", "computer_use"], value: patch.computer ?? undefined }] : []),
          ]
          const updated = yield* Effect.try({
            try: () =>
              fields.reduce(
                (current, field) =>
                  applyEdits(
                    current,
                    modify(current, field.path, field.value, { formattingOptions: { tabSize: 2, insertSpaces: true } }),
                  ),
                text,
              ),
            catch: (cause) => new FSUtil.FileSystemError({ method: "config.update", cause }),
          })
          yield* fs.writeWithDirs(filepath, updated.endsWith("\n") ? updated : `${updated}\n`)
          yield* requestReload
        },
        (effect) => updateLock.withPermit(effect),
      )

      // Rewrites the highest-precedence global config document through `edit`, keeping unrelated JSONC, then reloads.
      const editGlobal = Effect.fnUntraced(
        function* (method: string, edit: (text: string) => string) {
          const directory = initial.global ?? AbsolutePath.make(globalService.config)
          const candidates = ConfigDiscovery.names.map((name) => path.join(directory, name))
          const filepath =
            (yield* Effect.filter(candidates, fs.isFile)).at(-1) ?? path.join(directory, "opencode.jsonc")
          const text = (yield* fs.readFileStringSafe(filepath)) ?? "{}\n"
          const updated = yield* Effect.try({
            try: () => edit(text),
            catch: (cause) => new FSUtil.FileSystemError({ method, cause }),
          })
          yield* fs.writeWithDirs(filepath, updated.endsWith("\n") ? updated : `${updated}\n`)
          yield* requestReload
        },
        (effect) => updateLock.withPermit(effect),
      )
      const formatting = { formattingOptions: { tabSize: 2, insertSpaces: true } }

      const mcp = Effect.fn("Config.mcp")(function* (server: string, config: Mcp.ServerConfig | undefined) {
        yield* editGlobal("config.mcp", (text) => {
          // A V1 document lists servers directly under `mcp`; drop that entry so the name is not defined twice.
          // `servers` and `timeout` are the current format's own keys there, never a V1 server.
          const cleared =
            server === "servers" || server === "timeout"
              ? text
              : withoutEntry(text, ["mcp", server])
          return applyEdits(cleared, modify(cleared, ["mcp", "servers", server], config, formatting))
        })
      })

      const provider = Effect.fn("Config.provider")(function* (id: string, config: ConfigProvider.Info | undefined) {
        yield* editGlobal("config.provider", (text) => {
          // A V1 document defines providers under `provider`; drop that entry so the ID is not defined twice.
          const cleared = withoutEntry(text, ["provider", id])
          return applyEdits(cleared, modify(cleared, ["providers", id], config, formatting))
        })
      })

      const globalFile = Effect.fnUntraced(function* () {
        const directory = initial.global ?? AbsolutePath.make(globalService.config)
        const candidates = ConfigDiscovery.names.map((name) => path.join(directory, name))

        return (yield* Effect.filter(candidates, fs.isFile)).at(-1) ?? path.join(directory, "opencode.jsonc")
      })

      const rawProvider = (text: string, id: string) => {
        const document: unknown = parse(text, [], { allowTrailingComma: true })
        const providers = isRecord(document) && isRecord(document.providers) ? document.providers : {}

        return providers[id]
      }

      const providerEntry = Effect.fn("Config.providerEntry")(function* (id: string) {
        const file = yield* globalFile()
        const text = (yield* fs.readFileStringSafe(file).pipe(Effect.orElseSucceed(() => undefined))) ?? "{}"

        return { path: file, entry: ConfigSecrets.hide(rawProvider(text, id)) }
      })

      const providerSwitch = Effect.fn("Config.providerSwitch")(function* (id: string, enabled: boolean) {
        yield* editGlobal("config.providerSwitch", (text) => {
          const document: unknown = parse(text, [], { allowTrailingComma: true })
          const current = isRecord(document) && Array.isArray(document.policies) ? document.policies : []
          const kept = current.filter(
            (item) =>
              !(isRecord(item) && item.action === "provider.use" && item.resource === id && item.effect === "deny"),
          )
          const next = enabled ? kept : [...kept, { action: "provider.use", resource: id, effect: "deny" }]

          return applyEdits(text, modify(text, ["policies"], next.length > 0 ? next : undefined, formatting))
        })
      })

      const providerEdit = Effect.fn("Config.providerEdit")(function* (id: string, entry: ConfigProvider.Info) {
        yield* editGlobal("config.providerEdit", (text) => {
          const restored = ConfigSecrets.restore(entry, rawProvider(text, id))
          const cleared = withoutEntry(text, ["provider", id])

          return applyEdits(cleared, modify(cleared, ["providers", id], restored, formatting))
        })
      })

      const decisions = Effect.fn("Config.decisions")(function* (settings: ConfigExperimental.Decisions | undefined) {
        yield* editGlobal("config.decisions", (text) =>
          applyEdits(text, modify(text, ["experimental", "decisions"], settings, formatting)),
        )
      })

      const weather = Effect.fn("Config.weather")(function* (settings: ConfigExperimental.Weather | undefined) {
        yield* editGlobal("config.weather", (text) =>
          applyEdits(text, modify(text, ["experimental", "weather"], settings, formatting)),
        )
      })

      const time = Effect.fn("Config.time")(function* (settings: ConfigExperimental.Time | undefined) {
        yield* editGlobal("config.time", (text) =>
          applyEdits(text, modify(text, ["experimental", "time"], settings, formatting)),
        )
      })

      const addons = Effect.fn("Config.addons")(function* (settings: ConfigExperimental.Addons | undefined) {
        yield* editGlobal("config.addons", (text) =>
          applyEdits(text, modify(text, ["experimental", "addons"], settings, formatting)),
        )
      })

      const workers = Effect.fn("Config.workers")(function* (settings: ConfigExperimental.Workers | undefined) {
        yield* editGlobal("config.workers", (text) =>
          applyEdits(text, modify(text, ["experimental", "workers"], settings, formatting)),
        )
      })

      const listed = Effect.fn("Config.listed")(function* (key: "plugins" | "skills", entry: string, present: boolean) {
        yield* editGlobal("config.listed", (text) => {
          const document: unknown = parse(text, [], { allowTrailingComma: true })
          const current = isRecord(document) && Array.isArray(document[key]) ? document[key] : []
          // A plugin may be listed with options, as `{ package }`; it is the same plugin either way.
          const same = (item: unknown) => item === entry || (isRecord(item) && item.package === entry)

          if (current.some(same) === present) return text
          const next = present ? [...current, entry] : current.filter((item) => !same(item))

          return applyEdits(text, modify(text, [key], next.length === 0 ? undefined : next, formatting))
        })
      })

      return Service.of({
        entries: Effect.fnUntraced(function* () {
          return configs
        }),
        compatibility: () =>
          Effect.all({
            claude: Effect.filter(sources.claude, fs.isDir),
            agents: Effect.filter(sources.agents, fs.isDir),
          }),
        changes: () => Stream.fromPubSub(updates),
        update,
        mcp,
        provider,
        decisions,
        weather,
        time,
        addons,
        providerEntry,
        providerEdit,
        providerSwitch,
        workers,
        listed,
        integration: Effect.fn("Config.integration")(
          function* (integrationID, document) {
            if (!isDeepStrictEqual(integrations.get(integrationID), document)) {
              const previous = integrations.get(integrationID)
              integrations.delete(integrationID)
              if (document) integrations.set(integrationID, document)
              const failed = yield* reloadUnlocked().pipe(
                Effect.provide(context),
                Effect.as(false),
                Effect.catchCause((cause) =>
                  Effect.logError("failed to reload integration config", { integrationID, cause }).pipe(
                    Effect.as(true),
                  ),
                ),
              )
              if (failed) {
                integrations.delete(integrationID)
                if (previous) integrations.set(integrationID, previous)
                // Fail closed with a stripped policies-only document so a failed reload never registers denied providers.
                return document ? ConfigIntegration.result(document, false) : { _tag: "Cleared" as const }
              }
            }
            return integrationResults.get(integrationID) ?? { _tag: "Cleared" as const }
          },
          (effect) => reloadLock.withPermit(effect),
        ),
      })
    }),
  )

export function configured(options?: Options) {
  return makeLocationNode({
    service: Service,
    layer: layer(options),
    deps: [
      Watcher.node,
      Bus.node,
      FSUtil.node,
      Global.node,
      Location.node,
      Credential.node,
      WellKnown.node,
      AppProcess.node,
      App.node,
    ],
  })
}

export const node = configured()
