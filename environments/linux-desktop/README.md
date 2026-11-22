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

Use the current Electron workbench build and open **Workbench → Linux Desktop**.
Start the desktop. For Agent access, select an ordinary Workbench chat, enable
Computer Use, then click **Connect selected chat**. Ask the Agent to use
`computer_use` to observe and operate Mousepad. The Rust Host supervises the
chat and preserves its existing authorization. Guest screenshots and native
input run inside Linux. The chat's shell, files and model credentials are owned
by its existing Host.

**Take control** enables keyboard and pointer input in the viewer. **Return
control** releases manual input. The Agent observes again before it acts. The
viewer can close while the desktop runs, which returns any active manual
control. **Stop desktop** asks before removing the container and its files.
Normal Pero quit removes the desktop. Save anything you need outside the guest
before stopping it.

On other Unix hosts, build against a trusted Docker context by setting
`PERO_REMOTE_DESKTOP_CONTEXT` for `run.sh` and set
`PERO_REMOTE_DESKTOP_DOCKER_SOCKET` to that engine's absolute Unix socket path
when launching Electron. You can supply `PERO_REMOTE_DESKTOP_IMAGE` to both
commands for a locally built alternative image. The guest runs as a non-root
user with no published ports, host mounts or external network.

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
