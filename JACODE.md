# JaCode

JaCode is a desktop AI assistant built on [OpenCode](https://opencode.ai), the open source coding agent. It keeps
everything OpenCode does and adds a guided desktop app: one place to connect model providers, let the app pick a
model for each prompt, hand work to other computers that stay on, and see answers as cards and charts.

This page lists what JaCode adds, where to find it in the app, and the config keys behind it. Everything here can be
set from the app; the config keys are for people who prefer to edit `opencode.json` themselves.

## Getting it

JaCode is built from this repository. On a Mac:

```bash
bun install
```

```bash
bun script/fork-install.ts --open
```

That builds the desktop app, installs it as `/Applications/JaCode.app`, builds the matching Linux worker software, and
opens the app. The app keeps its own settings and data apart from any other OpenCode install, under
`~/Library/Application Support/OpenCodeFork/`.

On first launch a welcome card walks through picking a provider, adding its key and sending a first message.

## Chats

- **Chats without a folder.** Not every conversation is about code. "Chats" on Home holds conversations that are not
  tied to a project; they run in `~/JaCode Chats`.
- **Tabs and badges.** Tabs are colored by project, and each tab and chat header shows whether it runs on this
  computer or on a worker.
- **Unread dots.** A chat with news shows a dot: the accent color for a new answer, red for a run that failed, amber
  when it waits on you, and cyan when a worker brought back a result.
- **Startup animation.** While the app starts, the JaCode mark assembles out of chaos: one of five scenes, picked
  at random, that mix the Lorenz attractor with curl-noise flow. With reduced motion on, the mark shows still.
- **Thinking companion.** An optional pixel character keeps you company while a model works, and says what it is
  doing. Settings › Appearance.

## Auto: a model for each prompt

Pick **Auto** in the model picker and each prompt gets a model that suits it, chosen fresh every time. Pick a model
yourself and Auto stays out of it: that model answers every prompt.

How Auto picks, in two stages:

1. **A decision model judges the prompt.** It says whether it is a quick, everyday or hard task. Code notes whether
   the prompt has images and how much context it needs.
2. **Code narrows the models that fit.** From the models Auto may use, it keeps those that read the prompt's images,
   can hold it, and are strong enough for that kind of task: at most five, and at most two from one provider.
   Strength ranks models by price, whether they reason, a stronger or lighter name, and age.
3. **The decision model picks one** from that short list, told each model's price, context, reasoning, image input and
   release date. Both answers come from a single call to the decision model.
4. **That model answers.** The chip above the composer says which model answered and why.

When the decision model is unsure how hard a prompt is, the chat stays on the model it used last, or starts on an
everyday one. When a subscription's allowance is nearly used, everyday work drops to the quick list. When the
decision model cannot be reached, Auto picks without it and the chat says so once.

**Auto on every provider** uses the providers switched on in Settings › Models › Auto. **Auto on one provider** uses
only that provider. With a subscription, Auto keeps to the models it covers unless paid models are allowed.

**Plan before large tasks** (off by default) applies to every chat: when a prompt is a large task, the assistant
replies with a short plan and waits for your OK.

Settings › Models › Auto shows all of this as a flow chart, and has:

- the decision model (Jev when connected, else the first decision model a connected provider offers),
- a model to always use for a kind of task, per scope, left on "Picked for each prompt" by default,
- whether paid models are allowed, and whether to plan before large tasks,
- which providers Auto on every provider may use.

Config: `experimental.decisions`.

```jsonc
{
  "experimental": {
    "decisions": {
      "model": "opencode/jev-1.13-free",
      "tiers": { "all": { "hard": "<providerID>/<modelID>" } },
      "allowPaid": false,
      "plan": true,
      "confidence": 0.7,
    },
  },
}
```

## Workers: computers that stay on

A worker is another computer running JaCode's server: a home server, a VPS, or a Docker container on this Mac.
Settings › Workers adds one, with a guided setup that checks the machine, installs the worker software over SSH, and
can give it the same providers as this computer.

- **Chats on a worker.** Start a chat on a worker from Home; it keeps running while this computer sleeps or is off.
  A worker with a screen can be watched, view only, from the chat's header, with a switch to take control.
- **Hand a task to a worker.** A chat on this computer can schedule a task on a worker instead of locally, so it runs
  even while this computer is off. Ask for it in words, such as "schedule this on the worker for tomorrow at 9". The
  task gets its own chat on the worker, which keeps the results. More than one worker is supported, by name.
- **Results come back.** The chat that scheduled the task remembers the worker chat. When this computer starts, and
  every minute after, it checks for runs that finished and brings each result into that chat once; the chat then
  tells you the result and its dot turns cyan. While this computer is off, results wait on the worker.

The app keeps the list of workers in config as `experimental.workers`; there is nothing to edit by hand.

### Ways in: reaching this computer from a phone or another device

Settings › Workers › Pair a device connects a phone, tablet or another computer to JaCode on this computer; a phone
needs no app, only its browser. Under **Ways in** you choose how those devices get here, and put the choices in order:

- **Tailscale**: private to your own devices on your tailnet, encrypted end to end. JaCode serves itself on port 8443
  with `tailscale serve`; the tailnet needs HTTPS certificates turned on, and the device needs the Tailscale app.
- **Tailscale Funnel**: a public HTTPS address from Tailscale (port 10000), for devices without Tailscale.
- **OpenTunnel**: a public address through OpenCode's relay, which passes traffic it cannot read. This is the way a
  new install starts with.
- **Same network**: devices on the same Wi-Fi or LAN, over plain HTTP. Turning it on makes the background service
  listen beyond this computer.
- **Your own address**: an address you run yourself, such as a WireGuard address or a reverse proxy.

Each way shows whether it works now, at which address, or why not. The background service checks every address once a
minute. The Pair dialog lists every working address in your order. The QR code and Copy link use the first; pick another
in the list, such as OpenTunnel for a phone without Tailscale, and the code switches to it. A phone's camera opens
the code in the browser. The Remote access switch pauses every way at once; turning it
on again brings back what you chose. Nothing is reachable while JaCode's background service is stopped, and turning
Tailscale off removes JaCode's serve setting again. From a terminal: `opencode service get access-status`, and
`opencode service set access '<json>'`.

## Providers

Settings › Providers lists every connected provider once, under Connected providers.

- **Connect** a provider from the catalog with a key or an account.
- **Custom providers.** Add any OpenAI-compatible provider by its address. Once added it is listed with the connected
  ones, with its address under its name.
- **Show config.** A provider set up in a config file opens its settings as the file writes them. Check validates them
  against the provider schema; Save writes them back and they apply at once. References such as `{env:NAME}` stay as
  written, and a key written out in full shows as dots and keeps its value when you save.
- A provider's menu connects it with a key, edits a custom one, disconnects its key, or removes a custom provider.
- **Switch a provider off** with the switch on its row, for example to pause one plan while trying another. It keeps
  its key and settings and moves to "Switched off", where the same switch brings it back. Off is stored as a
  `provider.use` deny entry in `policies`.

**Usage.** The chat header shows how much of a plan is used, and its menu lists each allowance and the last 30 days by
model. Ask "how much have I used?" and the `usage` tool answers with a card.

| Provider   | What it reports                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| NanoGPT    | Subscription allowances (weekly input tokens, daily images), 30-day history by model, which models the plan covers |
| OpenRouter | Prepaid credits bought and spent, and the key's spending limit when it has one                                     |

More providers can be added the same way: one reader per provider, each with a fixed host so a key is only ever sent
to that provider (`packages/core/src/usage-subscription.ts`).

## Add-ons

Settings › Add-ons has three kinds:

- **MCPs**: outside programs that give the assistant tools, such as a calendar or a database. Settings › Connected
  tools is a page just for these.
- **Plugins**: code that adds tools, sign-ins or screens. "Included with JaCode" lists add-ons that come with the app,
  each off until switched on.
- **Skills**: instruction packs the assistant follows for a kind of task.

Included with JaCode:

- **Bible passages.** A `verse` tool that quotes Scripture word for word from public-domain translations (King James
  by default, World English, American Standard or Berean Standard), shown as a quote card, and outlines for sermons and
  studies. "Also in Spanish" adds the Reina-Valera 1909 text. Config: `experimental.addons.bible`.

## Cards and charts

Answers can include live visuals that the app draws in place: charts (Chart.js is built in), styled tables,
diagrams, and cards. The look of charts and cards is picked in Settings › Cards.

- **Weather card**, from the `weather` tool. Sources are free and need no key (MET Norway, Open-Meteo, wttr.in), tried
  in order; Settings › Cards › Weather sets the order and the units (this computer's region, Fahrenheit or Celsius).
  Config: `experimental.weather`.
- **Usage card**, from the `usage` tool.
- **Quote card** for any quotation, and **outline card** for a talk, lesson or plan.

Set `experimental.visuals: false` for clients that show text only.

## Exact time

The `time` tool reads the exact time from internet time servers (NTP) instead of trusting the computer's clock, so the
assistant can count down to deadlines and schedule precisely. Settings › Preferences › Time servers lists them, tried
in order, and they can be reordered. Config: `experimental.time.servers`.

## Languages

The app is in English and Spanish. Other languages fall back to English for JaCode's own screens.

## Config reference

| Key                      | What it sets                                    | In the app                           |
| ------------------------ | ----------------------------------------------- | ------------------------------------ |
| `experimental.decisions` | How Auto picks, and planning before large tasks | Settings › Models › Auto             |
| `experimental.workers`   | Workers chats may schedule tasks on             | Settings › Workers (kept by the app) |
| `experimental.addons`    | Add-ons that come with the app                  | Settings › Add-ons › Plugins         |
| `experimental.weather`   | Weather sources and units                       | Settings › Cards › Weather           |
| `experimental.time`      | Time servers                                    | Settings › Preferences               |
| `experimental.visuals`   | Whether models may answer with visuals          | —                                    |
| `providers.<id>`         | A provider's settings                           | Settings › Providers › Show config   |
