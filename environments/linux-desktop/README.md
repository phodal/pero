# Pero Linux Desktop

This image provides an X11 desktop with Openbox and Mousepad. It builds
`pero-computer` from the Pero repository. The same desktop is exposed through
the Computer Use NDJSON stream and two RFB streams for viewing and human input.
The image runs independently of Pero Desktop, Point and the Task Center.

## Build and run in Pero Desktop

On macOS, create a dedicated Colima profile. Docker commands in this directory
use its named context without activating it globally.

```sh
colima start pero-remote-desktop --runtime docker --cpu 3 --memory 4 --disk 12 --mount none --activate=false
./environments/linux-desktop/run.sh build
```

Use the current Electron Workbench build. In an ordinary conversation, open
the resources pane and select **Desktop**. **@remote → Linux Desktop** opens
the same tab from Composer. **Workbench → Linux Desktop** can open a
standalone viewer when the tab is hidden. Start the desktop. For Agent access, select an ordinary Workbench chat, enable
Computer Use, then click **Connect selected chat**. Ask the Agent to use
`computer_use` to observe and operate Mousepad. The Rust Host supervises the
chat and preserves its existing authorization. Guest screenshots and native
input run inside Linux. The chat's shell, files and model credentials are owned
by its existing Host.

**Take control** enables keyboard and pointer input in the viewer. **Return
control** releases manual input. The Agent observes again before it acts. The
viewer can close or switch resources while the managed desktop runs. Both
actions return any active manual control. **Stop desktop** asks before removing the container and its files.
Normal Pero quit removes the desktop. Save anything you need outside the guest
before stopping it.

On other Unix hosts, build against a trusted Docker context by setting
`PERO_REMOTE_DESKTOP_CONTEXT` for `run.sh` and set
`PERO_REMOTE_DESKTOP_DOCKER_SOCKET` to that engine's absolute Unix socket path
when launching Electron. You can supply `PERO_REMOTE_DESKTOP_IMAGE` to both
commands for a locally built alternative image. The guest runs as a non-root
user with no published ports, host mounts or external network.

## Blender desktop

The optional Blender image opens a fresh Blender application in the same
managed X11 desktop. Build the image and launch the current Electron build:

```sh
./environments/linux-desktop/run.sh build-blender
PERO_REMOTE_DESKTOP_IMAGE=pero/linux-desktop:blender npm start
```

Start it from the same Linux Desktop panel. Save or export files out of a
disposable desktop before stopping it.

`node tests/e2e/linux-desktop-blender.mjs` starts a separate container and
drives Blender through the native Computer Use stream. It records GUI
captures, receipts, a saved scene and matching OBJ geometry in
`test-results/linux-desktop-blender/`.

## Run independently

```sh
./environments/linux-desktop/run.sh start
./environments/linux-desktop/run.sh probe
./environments/linux-desktop/run.sh computer
```

Repeat `probe` until it exits successfully. In `computer`, send a line such as
`{"id":"probe","thread":"standalone","request":{"operation":"targets"}}` and end
the stream when done. Run `./environments/linux-desktop/run.sh observe` for the
read-only RFB byte stream, or `control` for the writable stream. A local RFB
viewer can attach via a loopback bridge, for example with `socat` installed:

```sh
socat TCP-LISTEN:5909,bind=127.0.0.1,reuseaddr EXEC:'./environments/linux-desktop/run.sh observe'
```

The `computer` and `control` streams share the guest's input lock. Close one
before opening the other. `PERO_REMOTE_DESKTOP_CONTAINER` can name a separate
standalone session. Use `./environments/linux-desktop/run.sh stop` to remove
the standalone guest.

## Connect an existing VNC desktop

Add the Linux host to OpenSSH with a verified host key. Open **Workbench →
Linux Desktop**, enter the SSH host or alias and the VNC port, and select
**Connect over SSH**. The SSH server forwards to its own `127.0.0.1`. The
connection uses SSH keys or ssh-agent, with any VNC credentials entered into
the viewer. Disconnecting closes the tunnel. This type of desktop offers
manual interaction.

The workbench uses the user's OpenSSH configuration. Set `PERO_SSH_CONFIG`
to an explicit local configuration file to select a separate SSH profile.

## Run the Pero Host on the Linux machine

Build or install the matching Linux `pero-host` on the SSH host. Configure
Agent executables and provider credentials on that machine. Its
`agents.json`, `runtime-settings.json`, and `history.jsonl` live under
`${XDG_CONFIG_HOME:-$HOME/.config}/pero`, or in the profile's optional `data`
directory. Open **Workbench → Open SSH Workbench…** and select a profile file:

```json
{
  "host": "research-linux",
  "workspace": "/home/research/project",
  "executable": "/opt/pero/bin/pero-host",
  "desktop": "/opt/pero/bin/managed-desktop"
}
```

The new window identifies the SSH host in its title. Its Rust Host, shell,
PTY, workspace files, Agent process and history are on Linux. OpenSSH
allocates a reverse loopback port for the session-authorized App Use MCP
channel. Remote access and forwarding must be enabled in the SSH account.

An ordinary SSH chat can also use local Browser Use. Open a workbench web tab
and choose **Workbench → Allow Browser Use for This Tab…**, or choose
**Workbench → Copy Chrome pairing code** and pair from the extension.
The consent displays the SSH destination. **Stop Browser Use** revokes the
embedded tab grant. **Disconnect Chrome** ends the Chrome pairing.
SSH Browser Use supports page input, observations and screenshots. File
transfer actions require a local conversation.

The optional `desktop` field names a launcher for an already running managed
desktop on the same host. It implements the `probe`, `observe`, `control`,
`computer`, and `input-idle` commands provided by this directory's runner.
For example, when using that runner on a remote Linux Docker engine:

```sh
#!/bin/sh
export PERO_REMOTE_DESKTOP_CONTEXT=default
exec /opt/pero/repo/environments/linux-desktop/run.sh "$@"
```

Build and start the image with the same context on the remote host. In the
SSH workbench, open **Linux Desktop → Connect this host's desktop**, then
attach the selected chat. Disconnecting the managed display releases input
and leaves the remote environment running.

## Pair another device

Run `npm run build:desktop` and start
`node environments/linux-desktop/relay.mjs` on the relay machine. Set
`PERO_DESKTOP_RELAY_KEY` to a high-entropy shared secret on both the relay
and the Electron owner. The relay listens on loopback, using
`PERO_DESKTOP_RELAY_PORT` or 8789. Route its HTTP and WebSocket requests
through an HTTPS reverse proxy. Set `PERO_DESKTOP_RELAY_URL` to that HTTPS
origin on the Electron owner.

From an active managed desktop, select **Share view**. To grant a paired
viewer keyboard and mouse input, take control in the workbench and select
**Share control**. The link is single-use and expires if nobody pairs.
End sharing at any time. Peer disconnect releases the owner's handoff.

The peer sends RFB over a WebRTC data channel when it connects. It can
fall back to the authenticated WebSocket relay. Set
`PERO_DESKTOP_TURN_URL` and `PERO_DESKTOP_TURN_SECRET` on the relay
to issue temporary credentials for a TURN server configured with that shared
secret. `PERO_DESKTOP_TURN_ONLY=1` restricts WebRTC negotiation to relay
candidates. Configure a trusted relay because it is the signaling endpoint
and can see the RFB traffic on the WebSocket fallback.
