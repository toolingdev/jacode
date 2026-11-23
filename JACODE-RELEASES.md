# JaCode releases

Each release lists what JaCode added and what it brought in from upstream OpenCode. Builds are on the
[Releases page](https://github.com/toolingdev/jacode/releases).

## 2026.11.23

The Mac app is still not signed, so macOS warns the first time it opens: right-click JaCode in Applications and choose
Open, or run `xattr -dr com.apple.quarantine /Applications/JaCode.app` in Terminal. An installed JaCode offers this
build as an update.

### Downloads

- `JaCode-2026.11.23-mac-arm64.zip`: the desktop app for Apple silicon Macs. Unzip and move JaCode to Applications.
- `opencode-linux-x64` and `opencode-linux-arm64`: the worker software for Linux computers, the same version as the
  app (`0.0.0-dev-202611231451`). The app installs and updates them on your workers itself.
- `jacode-release-0.0.0-dev-202611231451.json`: the manifest the app and workers use to find and check this release.

### What JaCode adds

- **Updates from JaCode's releases.** The app checks this repository's releases, downloads a newer build in the
  background and installs it with one click; workers move to the app's exact version.
- **Mac control.** A chat can see and work this Mac's screen; it asks in the chat first, and Settings has the page
  that controls it.
- **Helpers.** A chat can spread its work across helpers, each on its own model (Auto picks one per helper) or on a
  worker.
- **Tools per chat.** Switch connected tools on or off for one chat from the Tools pill.
- **Auto retries.** When the model Auto picked fails, the prompt moves at once to the next model that fits.
- **Long chats stay light.** A chat is summarized once it reaches about 200K tokens, even on models that hold more.
- Cards now show in the browser and on paired phones.

### Brought in from upstream OpenCode

212 upstream commits, through `698800f59c` (2026-11-23). Highlights:

- **Automations** are now a plain `automations` config key, on unless you set it to `false`. They can run a fixed shell
  command, scheduled code gets the chat's Code Mode tools, plugins can create and manage them, and the automation
  tools have their own `automation` group.
- **Model speeds**: a model's faster and slower service tiers (fast, flex) show as a speed of that model instead of
  separate entries.
- **Chats**: archive the open chat with ⌘⇧S, open a chat in the background from Home, drafts in the inbox sidebar,
  and send browser, file and review comments with Mod+Enter.
- **Timeline**: tall file diffs fold, a Code Mode script's diffs show while it runs, and long script groups no
  longer freeze the timeline.
- **Browser pane**: import browsing history and complete the address bar from it, open links beside the tab they came
  from, middle-click opens a new tab, and each site's icon shows in its tab.
- **Model picker** stays responsive with large catalogs and no longer jumps on open, scroll or select.
- **Other**: Claude Agent as a web search provider, key chords in shortcuts, back and forward mouse buttons, newer MCP
  protocol with push events, ChatGPT plan model lists from models.dev, and many focus-ring, compaction, shell and
  Windows fixes.

### Kept as JaCode has it

Where upstream changed code JaCode had changed, JaCode's version stays: Auto in the model picker (now beside model
speeds), the plan filter and prices in Settings › Models, "chat" wording in new texts, the JaCode name, and the
automation tools pinned so the model always knows it can schedule work.

### Replaced by upstream's version

- JaCode's own switch that kept automations on in every build. Upstream now keeps automations on by default in every
  build through the `automations` config key, so nothing changes for you; an old `experimental.automations` setting
  is still read.

### Left out

Nothing. Every upstream change came in.

## 2026.11.20

The first published JaCode build. The Mac app is not signed yet, so macOS warns the first time it opens: right-click
JaCode in Applications and choose Open, or run `xattr -dr com.apple.quarantine /Applications/JaCode.app` in Terminal.

### Downloads

- `JaCode-2026.11.20-mac-arm64.zip`: the desktop app for Apple silicon Macs. Unzip and move JaCode to Applications.
- `opencode-linux-x64` and `opencode-linux-arm64`: the worker software for Linux computers, the same version as the
  app. The app does not download these yet; copy the one for your worker's processor into
  `~/Library/Application Support/OpenCodeFork/desktop/worker/0.0.0-dev-202611201646/` on the Mac before adding a
  worker, or set the worker up from this repository with `script/fork-worker-setup.ts`.

### What JaCode adds

See [JACODE.md](JACODE.md) for the full guide. In short:

- **A new look.** The JaCode icon, a startup animation in which the mark assembles out of chaos (one of five scenes
  at random), and a new switch: a grey circle when off, a teal figure steered by a Lorenz system when on.
- **Chats without a folder**, tabs colored by project, unread dots that say whether news came from a worker, and an
  optional thinking companion.
- **Auto**: the app picks a model for each prompt from the providers you allow, in two stages.
- **Workers**: other computers that stay on. Start a chat on a worker, or hand a scheduled task to one; results come
  back to the chat that asked when this computer is on.
- **Providers**: connect from a catalog, add any OpenAI-compatible provider, see and edit config-file providers, and
  switch a provider off without removing it.
- **Add-ons** included with the app, such as Bible passages and weather units, all opt-in.
- **Cards and charts** for weather, usage, quotes and outlines, and the exact time from network time servers.
- **Ways in**: choose how a phone or another computer reaches this one (Tailscale, Tailscale Funnel, OpenTunnel, the
  same network, or an address of your own), put them in order, and see which work. Pairing picks the way the QR code
  uses, and a phone needs only its camera and browser.

### Brought in from upstream OpenCode

290 upstream commits, through `6e924965c6` (2026-11-19). Highlights:

- **Automations** replace schedules: run a prompt or a Code Mode program at a time, on an interval, on a cron, or when
  a connected MCP server sends an event. JaCode keeps them on in every build, and worker tasks use them too.
- **Browser pane**: signed-in browsing with extensions, previews, permission prompts, camera and microphone for sites
  you allow, and mobile and custom viewport sizes.
- **Tabs and sidebar**: experimental tab groups, group and sort options for recent chats, pin and mute, and a setting
  to keep the side panel across chats.
- **Code Mode**: scripts that run long move to the background and show as running work; more file and path APIs.
- **Plugins** can be checked for updates and updated in Settings › Extensions; `name@latest` plugins update
  themselves.
- **Timeline**: math renders as display math, long code lines wrap, conversation search has previous and next
  buttons, and the copy button always shows.
- **Models**: GPT 6.2 Sol and Astra in the ChatGPT list, Claude Agent usage control, and an experimental video tool.
- New icon artwork, unified focus rings, and many fixes.

### Kept as JaCode has it

Where upstream changed something JaCode had already changed, JaCode's version stays: the switch design, "chat"
wording, the JaCode name, pairing under Workers, and no self-updating from upstream's feeds.
