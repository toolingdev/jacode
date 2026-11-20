# JaCode releases

Each release lists what JaCode added and what it brought in from upstream OpenCode. Builds are on the
[Releases page](https://github.com/toolingdev/jacode/releases).

## 2026.11.20

The first published JaCode build. The Mac app is not signed yet, so macOS warns the first time it opens: right-click
JaCode in Applications and choose Open, or run `xattr -dr com.apple.quarantine /Applications/JaCode.app` in Terminal.

### Downloads

- `JaCode-2026.11.20-mac-arm64.zip`: the desktop app for Apple silicon Macs. Unzip and move JaCode to Applications.
- `opencode-linux-x64` and `opencode-linux-arm64`: the worker software for Linux computers, the same version as the
  app. The app does not download these yet; copy the one for your worker's processor into
  `~/Library/Application Support/OpenCodeFork/desktop/worker/0.0.0-dev-202611200615/` on the Mac before adding a
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
